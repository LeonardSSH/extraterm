/**
 * Copyright 2015 Simon Edwards <simon@simonzone.com>
 */
import child_process = require('child_process');
import ptyconnector = require('./ptyconnector');
import _ = require("lodash");
import configInterfaces = require('./config');
import fs = require('fs');
import path = require('path');
import Logger = require('./logger');

type Config = configInterfaces.Config;

type PtyConnector = ptyconnector.PtyConnector;
type Pty = ptyconnector.Pty;
type PtyOptions = ptyconnector.PtyOptions;

const DEBUG_FINE = false;

const _log = new Logger("ptyproxy");

const TYPE_CREATE = "create";
const TYPE_CREATED = "created";
const TYPE_WRITE = "write";
const TYPE_OUTPUT = "output";
const TYPE_RESIZE = "resize";
const TYPE_CLOSED = "closed";
const TYPE_TERMINATE = "terminate";

interface ProxyMessage {
  type: string;
  id: number;
}

interface CreatePtyMessage extends ProxyMessage {
  argv: string[];
  rows: number;
  columns: number;
  env: { [key: string]: string; };
  
  // the id field is not user for this message type.
}

interface CreatedPtyMessage extends ProxyMessage {
}

interface WriteMessage extends ProxyMessage {
  data: string;
}

interface ResizeMessage extends ProxyMessage {
  rows: number;
  columns: number;
}

// Output generated by the process on the other side of the pty.
interface OutputMessage extends ProxyMessage {
  data: string;
}

interface ClosedMessage extends ProxyMessage {
}

interface TerminateMessage extends ProxyMessage {  
}

const NULL_ID = -1;

class ProxyPty implements Pty {
  
  private _id: number = NULL_ID;
    
  private _dataListener: (data: any) => void = null;
    
  private _exitListener: () => void = null;
  
  private _writeFunc: (id: number, msg: ProxyMessage) => void = null;
  
  // Pre-open write queue.
  private _writeQueue: ProxyMessage[] = [];
  
  private _live = true;
  
  constructor(writeFunc) {
    this._writeFunc = writeFunc;
  }
  
  get id(): number {
    return this._id;
  }
  
  set id(id: number) {
    this._id = id;
    if (this._live) {
      this._writeQueue.forEach( (msg) => {
        msg.id = this._id;
        this._writeFunc(this._id, msg);
      });
      this._writeQueue = [];
    }
  }
  
  private _writeMessage(id: number, msg: ProxyMessage): void {
    if (this._live) {
      if (this._id === -1) {
        // We don't know what the ID of the pty in the proxy is.
        // Queue up this message for later.
        this._writeQueue.push(msg);
      } else {
        this._writeFunc(this._id, msg);
      }
    }
  }
  
  write(data: any): void {
    const msg: WriteMessage = { type: TYPE_WRITE, id: this._id, data: data };
    this._writeMessage(this._id, msg);
  }
  
  resize(cols: number, rows: number): void {
    const msg: ResizeMessage = { type: TYPE_RESIZE, id: this._id, rows: rows, columns: cols };
    this._writeMessage(this._id, msg);
  }
  
  onData(callback: (data: any) => void): void {
    this._dataListener = callback;
  }
  
  data(data: string): void {
    if (this._live && this._dataListener !== null) {
      this._dataListener(data);
    }
  }
  
  onExit(callback: () => void): void {
    this._exitListener = callback;
  }
  
  exit(): void {
    if (this._exitListener !== null) {
      this._live = false;
      this._exitListener();
    }
  }
  
  destroy(): void {    
  }
}

function findCygwinPython(cygwinDir: string): string {
  const binDir = path.join(cygwinDir, 'bin');
  _log.info("binDir:", binDir);
  const pythonRegexp = /^python3.*m\.exe$/;
  if (fs.existsSync(binDir)) {
    const pythons = fs.readdirSync(binDir).filter( name => pythonRegexp.test(name) );
    return pythons.length !== 0 ? path.join(binDir,pythons[0]) : null;
  }
  return null;
}

export function factory(config: Config): PtyConnector {
  const ptys: ProxyPty[] = [];
  const sessionProfile = config.expandedProfiles[0];
  const pythonExe = findCygwinPython(sessionProfile.cygwinDir);
  _log.info("Found python exe: ", pythonExe);

  // pythonExe = "python3";
  if (pythonExe === null) {
    return null;
  }

  const serverEnv = _.clone(process.env);
  serverEnv["PYTHONIOENCODING"] = "utf-8:ignore";
  const proxy = child_process.spawn(pythonExe, ['python/ptyserver2.py'], {env: serverEnv});
  let messageBuffer = "";

  proxy.stdout.on('data', function(data: Buffer) {
    if (DEBUG_FINE) {
      _log.debug("main <<< server : ", data);
    }
    messageBuffer = messageBuffer + data.toString('utf8');
    processMessageBuffer();
  });

  proxy.stderr.on('data', function (data: Buffer) {
    _log.warn('ptyproxy process stderr: ', data);
  });

  proxy.on('close', function (code) {
    if (DEBUG_FINE) {
      _log.debug('bridge process closed with code: ', code);
    }
  });
  
  proxy.on('exit', function (code) {
    if (DEBUG_FINE) {
      _log.debug('bridge process exited with code: ', code);
    }
  });
  
  proxy.on('error', (err) => {
    _log.severe("Failed to start process " + pythonExe + ". ", err);
  });

  function processMessageBuffer(): void {
    while (true) {
      const end = messageBuffer.indexOf('\n');
      if (end !== -1) {
        const msgString = messageBuffer.slice(0, end);
        messageBuffer = messageBuffer.slice(end+1);
        const msg = <ProxyMessage> JSON.parse(msgString);
        processMessage(msg);
      } else {
        break;
      }
    }
  }

  function processMessage(msg: ProxyMessage): void {
    const msgType = msg.type;
    
    if (msgType === TYPE_CREATED) {
      const createdPtyMsg = <CreatedPtyMessage> msg;
      for (let i=0; i<ptys.length; i++) {
        const pty = ptys[i];
        if (pty.id === NULL_ID) {
          pty.id = createdPtyMsg.id;
          break;
        }
      }
      return;
    }
    
    if (msgType === TYPE_OUTPUT) {
      const outputMsg = <OutputMessage> msg;
      const pty = findPtyById(outputMsg.id);
      if (pty !== null) {
        pty.data(outputMsg.data);
      }
    }
    
    if (msgType === TYPE_CLOSED) {
      const closedMsg = <ClosedMessage> msg;
      const pty = findPtyById(closedMsg.id);
      if (pty !== null) {
        pty.exit();
      }      
    }
  }
  
  function findPtyById(id: number): ProxyPty {
    for (let i=0; i<ptys.length; i++) {
      if (ptys[i].id === id) {
        return ptys[i];
      }
    }
    return null;
  }
  
  function sendMessage(id: number, msg: ProxyMessage): void {
    const msgText = JSON.stringify(msg);
    proxy.stdin.write(msgText + "\n", 'utf8');
  }
  
  function spawn(file: string, args: string[], opt: PtyOptions): Pty {
    let rows = 24;
    let columns = 80;
    if (DEBUG_FINE) {
      _log.debug("ptyproxy spawn file: ", file);
    }
    if (opt !== undefined) {
      rows = opt.rows !== undefined ? opt.rows : rows;
      columns = opt.cols !== undefined ? opt.cols : columns;
    }
    const pty = new ProxyPty(sendMessage);
    ptys.push(pty);
    const msg: CreatePtyMessage = { type: TYPE_CREATE, argv: [file, ...args], rows: rows, columns: columns, id: -1, env: opt.env };
    sendMessage(null, msg);
    return pty;
  }
  
  function destroy() {
    const msg: TerminateMessage = { type: TYPE_TERMINATE, id: -1 };
    sendMessage(null, msg);
  }
  
  return {
    spawn: spawn,
    destroy: destroy
  };
}
