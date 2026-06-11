// Phase-1.5a scan stub — the dummy verdict engine behind the Scanner port. The
// MVP runs invite-only ("safe" environment), so the verdict is always `clean`
// while the full async pipeline (queue → worker → promote) runs for real. The
// production engine (ClamAV signature scan + phishing/miner heuristics, ADR-0012)
// replaces this class with zero call-site change. Boundary layer (ADR-0020/0024).
import type { Scanner, ScanRequest } from "arp-application";
import { type AppError, ok, type Result, type TerminalScanStatus } from "arp-domain";

export class CleanStubScanner implements Scanner {
  async scan(_req: ScanRequest): Promise<Result<TerminalScanStatus, AppError>> {
    return ok("clean");
  }
}
