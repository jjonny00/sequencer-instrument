import { useState } from "react";

type EditingSlot = { rowIndex: number; columnIndex: number } | null;

type UseTimelineStateOptions = {
  initialEditingSlot?: EditingSlot;
  initialRowSettingsIndex?: number | null;
  initialExpanded?: boolean;
};

export function useTimelineState({
  initialEditingSlot = null,
  initialRowSettingsIndex = null,
  initialExpanded = false,
}: UseTimelineStateOptions = {}) {
  const [editingSlot, setEditingSlot] = useState<EditingSlot>(initialEditingSlot);
  const [rowSettingsIndex, setRowSettingsIndex] = useState<number | null>(
    initialRowSettingsIndex
  );
  const [isTimelineExpanded, setTimelineExpanded] = useState(initialExpanded);

  return {
    editingSlot,
    setEditingSlot,
    rowSettingsIndex,
    setRowSettingsIndex,
    isTimelineExpanded,
    setTimelineExpanded,
  };
}
