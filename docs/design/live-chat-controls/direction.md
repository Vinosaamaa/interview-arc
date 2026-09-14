# Live Chat Controls

The owner requested a standalone widget, multiple editable buttons, short labels,
and exact custom messages. The concept board was shown before implementation;
the owner named the widget Live Chat Controls and requested implementation.

Use the compact grid and separate editor in [the concept](concept.png). Start
with only Continue; the other illustrated buttons are examples the owner may
add. Edit changes the meaning of grid taps to editing, with a visible Done state.
Saving is separate from sending. Delete has Undo. On small screens, labels wrap
and the grid scrolls as the collection grows. Use Arc paper/mineral/deep-teal
tokens, consistent controls and visible keyboard focus.

Reference research: [Apple shortcut widgets](https://support.apple.com/en-sg/guide/shortcuts/apd029b36d05/ios)
distinguish a single shortcut from a collection and run a shortcut on tap.
[Apple button guidance](https://developer.apple.com/design/human-interface-guidelines/buttons)
informs short labels and consistent touch targets.

Self-review: the control collection has no dependency on playback or recording.
Only the default action gets emphasis; settings use a quiet Edit control. Editing
must never dispatch a prompt. The browser sandbox rejects form submission, so
Save uses a direct click handler and keyboard-accessible button. Historical
player cards can remain cached; fresh player opens use a resource without chat
controls. This design does not claim native Live stop detection.
