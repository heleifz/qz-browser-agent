/** Page-action unit fixtures isolate dialog lifecycle, covered by test-javascript-dialog.mjs. */
export const pageDialogStub = {
  async withPageDialogGuard(_tabId, _context, run) {
    let underlying;
    const send = (method, params) => underlying(method, params);
    const value = await run(send, async real => { underlying = real; Object.assign(send, real); });
    return { value, dialogs: [] };
  },
  attachPageDialogResults: result => result,
};
