import type {
  InteractionModePhase,
  InteractionModeRegistry,
  PracticeSpecialty,
} from "../db/interaction-mode-policy";

export function selectableInteractionModes(
  registry: InteractionModeRegistry,
  specialty: PracticeSpecialty,
  phase: InteractionModePhase,
) {
  return registry.modes.filter((mode) => (
    !mode.deprecated
    && mode.supportedSpecialties.includes(specialty)
    && mode.selectableWhen.includes(phase)
  ));
}
