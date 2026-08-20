// Keyboard-shortcut guards shared by the reader, practice and chat surfaces.

/**
 * True while an input method editor is composing, so a shortcut must not fire
 * (#289 4.5). Chinese, Japanese and Korean text is typed through an IME: the
 * user types Latin letters, a candidate list appears, digits 1-4 pick a
 * candidate, and Space or Enter commits it. Those are the exact keys practice
 * binds to multiple choice and to submit, and the reader binds to word level.
 * Without this guard, choosing a candidate also answers the question.
 *
 * `isComposing` is the standard signal. `keyCode === 229` is what older IMEs and
 * several Android keyboards send instead, and it is the only signal available on
 * the `keydown` that starts a composition in some browsers.
 */
export function isComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229;
}
