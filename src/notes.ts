export type NoteName = "low" | "mid" | "high";

export type NoteMap = Record<NoteName, string>;

let noteMap: NoteMap = {
  low: "C2",
  mid: "C4",
  high: "C5"
};

export function setNoteMap(map: NoteMap) {
  noteMap = map;
}

export function getNote(note: NoteName) {
  return noteMap[note];
}
