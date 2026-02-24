import React from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography
} from '@mui/material';

interface MoveGroupDialogProps {
  open: boolean;
  sourceWindowId?: number;
  onClose: () => void;
  onConfirm: (targetWindowId: number) => Promise<void>;
}

export default function MoveGroupDialog({
  open,
  sourceWindowId,
  onClose,
  onConfirm
}: MoveGroupDialogProps) {
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [windows, setWindows] = React.useState<chrome.windows.Window[]>([]);
  const [targetWindowId, setTargetWindowId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setTargetWindowId(null);

    chrome.windows.getAll({ populate: false })
      .then((allWindows) => {
        if (cancelled) return;
        const eligible = allWindows.filter((w) => w.id !== undefined && w.id !== sourceWindowId);
        setWindows(eligible);
        if (eligible.length > 0 && eligible[0].id !== undefined) {
          setTargetWindowId(eligible[0].id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load windows');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, sourceWindowId]);

  const handleConfirm = async () => {
    if (targetWindowId === null || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(targetWindowId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move group');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Move Group To Window</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 0.5 }}>
          {loading && <Typography variant="body2">Loading windows…</Typography>}

          {!loading && windows.length === 0 && (
            <Alert severity="info">No eligible target windows are available.</Alert>
          )}

          {!loading && windows.length > 0 && (
            <RadioGroup
              value={targetWindowId === null ? '' : String(targetWindowId)}
              onChange={(event) => setTargetWindowId(Number(event.target.value))}
            >
              {windows.map((window) => (
                <FormControlLabel
                  key={window.id}
                  value={String(window.id)}
                  control={<Radio />}
                  label={`Window ${window.id}${window.type ? ` (${window.type})` : ''}`}
                />
              ))}
            </RadioGroup>
          )}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={submitting || loading || windows.length === 0 || targetWindowId === null}
        >
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}
