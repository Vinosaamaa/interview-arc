import "./career-materials-mark.css";

export function CareerMaterialsMark() {
  return (
    <span className="career-materials-mark" aria-hidden="true">
      <svg viewBox="0 0 26 26" fill="none" focusable="false">
        <rect className="career-materials-mark-leaf career-materials-mark-leaf-back" x="8.15" y="4.7" width="12.2" height="13.05" rx="1.45" />
        <rect className="career-materials-mark-leaf career-materials-mark-leaf-mid" x="6.55" y="6.15" width="12.35" height="13.2" rx="1.45" />
        <rect className="career-materials-mark-leaf career-materials-mark-leaf-front" x="5.05" y="7.55" width="12.55" height="13.55" rx="1.5" />
        <path className="career-materials-mark-spine" d="M7.35 9.05v10.55" />
        <path className="career-materials-mark-stitch" d="M6.15 11.2h2.4M6.15 14.55h2.4M6.15 17.9h2.4" />
      </svg>
    </span>
  );
}
