import React from 'react';
import {
  Alert,
  Button,
  Chip,
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
import { buildWindowLabels, WindowLabel } from '../lib/utils/windowLabelBuilder';

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
  const [windowLabels, setWindowLabels] = React.useState<WindowLabel[]>([]);
  const [targetWindowId, setTargetWindowId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setTargetWindowId(null);

    Promise.all([
      chrome.windows.getAll({ populate: true }),
      chrome.tabGroups.query({})
    ])
      .then(([allWindows, allTabGroups]) => {
        if (cancelled) return;
        const eligible = allWindows.filter((w) => w.id !== undefined && w.id !== sourceWindowId);
        const labels = buildWindowLabels(eligible, allTabGroups);
        setWindowLabels(labels);
        if (labels.length > 0) {
          setTargetWindowId(labels[0].windowId);
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

          {!loading && windowLabels.length === 0 && (
            <Alert severity="info">No eligible target windows are available.</Alert>
          )}

          {!loading && windowLabels.length > 0 && (
            <RadioGroup
              value={targetWindowId === null ? '' : String(targetWindowId)}
              onChange={(event) => setTargetWindowId(Number(event.target.value))}
            >
              {windowLabels.map((wl) => (
                <FormControlLabel
                  key={wl.windowId}
                  value={String(wl.windowId)}
                  control={<Radio />}
                  label={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">
                        {wl.label}
                        <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.secondary' }}>
                          — {wl.tabCount} tab{wl.tabCount !== 1 ? 's' : ''}
                        </Typography>
                      </Typography>
                      {wl.isFocused && (
                        <Chip label="focused" size="small" color="primary" variant="outlined" />
                      )}
                    </Stack>
                  }
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
          disabled={submitting || loading || windowLabels.length === 0 || targetWindowId === null}
        >
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}
