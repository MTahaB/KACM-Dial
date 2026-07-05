// Aperture iris — eight brass blades that open and close while the document
// pre-generates. The final cycle ends fully open (never closed) to signal
// "ready". Pure inline SVG, no network, no dependency.

const BLADES = Array.from({ length: 8 }, (_, i) => i);

export default function IrisLoader() {
  return (
    <svg className="iris" viewBox="0 0 200 200" aria-hidden focusable="false">
      {BLADES.map((i) => (
        <g
          key={i}
          className="iris-blade"
          style={
            {
              "--rot": `${i * 45}deg`,
              animationDelay: `${i * 30}ms`,
            } as React.CSSProperties
          }
        >
          <path
            d="M100,100 L100,14 L142,26 Z"
            fill="var(--brass-dim)"
            stroke="var(--brass)"
            strokeWidth="1"
          />
        </g>
      ))}
      <circle cx="100" cy="100" r="16" fill="var(--housing)" stroke="var(--brass)" strokeWidth="1.5" />
    </svg>
  );
}
