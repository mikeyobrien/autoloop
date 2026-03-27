# Plan: make `tonic check .` pass

1. Run `tonic check .` and capture the first concrete failure.
2. Apply the smallest code or config fix for that failure.
3. Re-run `tonic check .` to verify a clean pass.
4. Hand off for review/finalization only after the green check is confirmed.
