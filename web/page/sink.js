// Where a file made in this window goes: a file the user picks (the save dialog comes first, so a cancel there costs
// no download), or a Blob that downloads at the end.
import { TEST } from './state.js';

export const openSink = async (name, type) => {
  if (window.showSaveFilePicker && !TEST) {
    const h = await window.showSaveFilePicker({ suggestedName: name, types: [type] });
    const ws = await h.createWritable();
    return { kind: 'file', name: h.name, write: (u8) => ws.write(u8), close: () => ws.close(), abort: () => ws.abort() };
  }
  const parts = [];
  return { kind: 'blob', name, write: async (u8) => { parts.push(u8); },
    close: async () => new Blob(parts, { type: Object.keys(type.accept)[0] }), abort: async () => { parts.length = 0; } };
};

export const sinkError = (e) => (e.name === 'AbortError' ? 'Nem választottál helyet a mentéshez, semmi nem töltődött le.'
  : `Nem tudom menteni: ${e.message}`);
