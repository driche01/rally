/**
 * Tiny JSON-response helpers so route handlers stay one-liners at
 * the bottom. Centralizes the {ok, error} envelope.
 */

import { NextResponse } from "next/server";

export function json<T>(body: T, init?: number | ResponseInit) {
  return NextResponse.json(body, typeof init === "number" ? { status: init } : init);
}

export function jsonOk<T>(data: T) {
  return NextResponse.json({ ok: true, data });
}

export function jsonErr(status: number, code: string, message?: string) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}
