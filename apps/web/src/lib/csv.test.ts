import assert from "node:assert/strict";
import { test } from "node:test";

import { escapeCsvCell, neutralizeCsvFormula, toCsv } from "./csv.ts";

/**
 * OH Defender MEDIUM on PR #326 — the admin mint-whitelist export quotes applicant free text but
 * did not neutralize spreadsheet formulas, so `name`/`contact`/`reason` (an unauthenticated form)
 * could execute on an operator's machine when the CSV was opened.
 */

test("formula triggers = + - @ are neutralized with a leading single quote", () => {
  for (const value of ["=1+1", "+SUM(A1)", "-2+3", "@SUM(A1)"]) {
    assert.equal(neutralizeCsvFormula(value), `'${value}`);
  }
});

test("TAB and CR triggers are neutralized", () => {
  for (const value of ["\t=cmd", "\r=cmd"]) {
    assert.equal(neutralizeCsvFormula(value), `'${value}`);
  }
});

test("triggers after leading whitespace are neutralized too", () => {
  for (const value of [" =1+1", "   +SUM(A1)", "\t-2", "\r@cmd", " \t=cmd"]) {
    assert.equal(neutralizeCsvFormula(value), `'${value}`);
  }
});

test("normal values are unchanged", () => {
  for (const value of ["", "Alice", " alice@example.com", "0x1234abcd", "100 USDC", "just text", "  leading spaces"]) {
    assert.equal(neutralizeCsvFormula(value), value);
  }
});

test("quotes, commas and newlines keep RFC-4180 escaping", () => {
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvCell("a,b"), '"a,b"');
  assert.equal(escapeCsvCell("line1\nline2"), '"line1\nline2"');
});

test("a dangerous cell is prefixed before quoting", () => {
  assert.equal(escapeCsvCell("=cmd"), `"'=cmd"`);
  assert.equal(escapeCsvCell('=HYPERLINK("http://evil","x")'), `"'=HYPERLINK(""http://evil"",""x"")"`);
  assert.equal(escapeCsvCell("  =cmd"), `"'  =cmd"`);
});

test("toCsv builds a quoted document with a trailing newline", () => {
  assert.equal(
    toCsv([
      ["address", "name"],
      ["0xabc", "=cmd"],
    ]),
    '"address","name"\n"0xabc","\'=cmd"\n',
  );
});
