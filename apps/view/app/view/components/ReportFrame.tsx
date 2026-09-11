// The framed report (ADR-0089 §2) — the canonical `/<slug>` itself, in a
// sandboxed iframe, byte for byte what a share-link visitor gets.
//
// The attribute set is imported from `../frame`, never restated inline: it is
// the record of a measurement (the 2026-09-09 spike on Chromium 148), and a
// component that retypes it is a component that can drift from it silently.
import { useEffect, useRef } from "react";
import { REPORT_FRAME_ALLOW, REPORT_FRAME_SANDBOX, reportFrameSrc } from "../frame";

export interface ReportFrameProps {
  readonly slug: string;
  /** The chrome page's own hash, forwarded into the frame so `/<slug>/view#3`
   *  lands on slide 3. Read on the server as "" and hydrated from
   *  `location.hash` on the client. */
  readonly hash: string;
  readonly title: string;
}

export function ReportFrame({ slug, hash, title }: ReportFrameProps) {
  const ref = useRef<HTMLIFrameElement>(null);

  // Focus the frame once it has loaded. Without this the first arrow key goes
  // to the chrome document and a deck sits on slide 1 until the user clicks
  // it — the single thing that makes a framed deck feel broken. `focus` on the
  // element hands the key events to the framed document (spike Q3); we cannot
  // reach INTO the frame to focus anything, and must not be able to, because
  // it is an opaque origin.
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    const focus = () => frame.focus();
    // Cover both orders: a frame that loads after mount fires `load`, and one
    // already loaded from cache never will.
    frame.addEventListener("load", focus);
    focus();
    return () => frame.removeEventListener("load", focus);
  }, []);

  return (
    <iframe
      ref={ref}
      // `title` is the report's own, so the frame is announced as the document
      // it contains rather than as "iframe".
      title={title}
      src={reportFrameSrc(slug, hash)}
      sandbox={REPORT_FRAME_SANDBOX}
      allow={REPORT_FRAME_ALLOW}
      className="h-full w-full border-0 bg-surface"
    />
  );
}
