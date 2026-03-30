# Plan: QA metrics bug queue

1. **Diagnose the active QA bug**
   - Refresh `.autoloop/bug-report.md` to bug 3 from `qa-report.md`.
   - Capture an exact reproduction with metric values containing `\\`, newline, and carriage return.
   - Confirm which escaping helper or formatter is responsible.

2. **Apply the smallest fix for that bug**
   - Change only the JSON escaping path needed for the active failure.
   - Add focused regression coverage for the reproduced escaping cases.

3. **Verify independently**
   - Run `tonic check .`.
   - Run `bin/test`.
   - Run a manual JSON metrics smoke check that exercises the escaping path.

4. **Close or queue**
   - Close bug 3 only after verification passes.
   - Keep remaining non-blocking issues explicitly tracked in `.autoloop/progress.md`.

## Current slice
Diagnose bug 3 from `qa-report.md`: incomplete JSON escaping in metrics export.
