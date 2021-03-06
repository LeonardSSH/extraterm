/*
 * Copyright 2020 Simon Edwards <simon@simonzone.com>
 *
 * This source code is licensed under the MIT license which is detailed in the LICENSE.txt file.
 */
import { Screen } from "./Screen";
import { Tab } from "./Tab";

/**
 * A block of content stacking inside a terminal.
 *
 * This includes terminal out, image viewers, frames, and other things.
 */
export interface Block {
  /**
   * Identifies this type of block.
   *
   * For terminal output and current block receiving terminal output, this
   * string will be equal to `TerminalType`, and the `details` field will
   * contain a `TerminalDetails` object.
   */
  readonly type: string;

  /**
   * Type specific details and methods for this block.
   */
  readonly details: any;

  /**
   * The Tab this block is on.
   */
  readonly tab: Tab;
}

/**
 * Identifies a `Block` of type terminal output in the `Block.type` field.
 */
export const TerminalOutputType = "extraterm:terminal-output";

export enum FindStartPosition {
  CURSOR,
  DOCUMENT_START,
  DOCUMENT_END,
}

export interface FindOptions {
  backwards?: boolean;
  startPosition?: FindStartPosition;
}

/**
 * Terminal output specific details and methods.
 *
 * This object is present in `Block.details` when a block's `type` is
 * equal to `TerminalType`.
 *
 * Some methods return row contents in the form of a normal JavaScript string.
 * Note that there isn't a simple one to one correspondence between
 * 'characters' / values in a string and cells in the terminal. JavaScript
 * strings are an array of 16bit (UTF16) values but Unicode has a 32bit range.
 * Multiple 16bit values can map to one Unicode codepoint. Also, characters
 * inside the terminal can be one cell wide or two cells wide.
 */
export interface TerminalOutputDetails {
  /**
   * True if this output viewer is connected to a live PTY and emulator.
   *
   * @return true if this output viewer is connected to a live PTY and emulator.
   */
  readonly hasPty: boolean;

  readonly scrollback: Screen;

  find(needle: string | RegExp, options?: FindOptions): boolean;
  findNext(needle: string | RegExp): boolean;
  findPrevious(needle: string | RegExp): boolean;
  hasSelection(): boolean;
  highlight(needle: string |  RegExp): void;

  /**
   * True if this block of terminal output still exists.
   */
  readonly isAlive: boolean;
}

/**
 * Identifies a `Block` of type text viewer in the `Block.type` field.
 */
export const TextViewerType = "extraterm:text-viewer";

/**
 * Text viewer specific details and methods.
 *
 * This object is present in `Block.details` when a block's `type` is
 * equal to `TextViewerType`.
 */
export interface TextViewerDetails {
  /**
   * The configured tab size.
   */
  readonly tabSize: number;

  /**
   * Set the tab size.
   */
  setTabSize(size: number): void;

  /**
   * The mimetype of the contents of this text viewer.
   */
  readonly mimeType: string;

  /**
   * Set the mimetype of the cotnent of this text viewer.
   */
  setMimeType(mimeType: string): void;

  /**
   * Return true if line numbers are being shown in the gutter.
   */
  readonly showLineNumbers: boolean;

  /**
   * Set whether to show line numebrs in the gutter.
   */
  setShowLineNumbers(show: boolean): void;

  /**
   * True if long lines are set to be wrapped.
   */
  readonly wrapLines: boolean;

  /**
   * Set whether long lines should be wrapped.
   */
  setWrapLines(wrap: boolean): void;

  find(needle: string | RegExp, options?: FindOptions): boolean;
  findNext(needle: string | RegExp): boolean;
  findPrevious(needle: string | RegExp): boolean;
  hasSelection(): boolean;
  highlight(needle: string |  RegExp): void;

  /**
   * True if this block still exists.
   */
  readonly isAlive: boolean;
}
