import React from "react";

interface ThemeToggleProps {
  theme: "dark" | "light";
  onToggle: () => void;
  className?: string;
}

const T = "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)";

/** Animated sun / moon switch. Unchecked = light (sun), checked = dark (moon). */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ theme, onToggle, className = "" }) => {
  const night = theme === "dark";

  return (
    <label
      title={night ? "Switch to Light Mode" : "Switch to Dark Mode"}
      className={`relative inline-block cursor-pointer select-none w-[62px] flex-shrink-0 ${className}`}
    >
      <input
        type="checkbox"
        checked={night}
        onChange={onToggle}
        aria-label="Toggle dark mode"
        className="absolute opacity-0 w-0 h-0"
      />
      <svg viewBox="0 0 69.667 44" xmlns="http://www.w3.org/2000/svg" className="block w-full h-auto">
        <g transform="translate(3.5 3.5)">
          {/* Sky */}
          <rect
            x="0"
            y="0"
            rx="17.5"
            width="60.667"
            height="35"
            style={{ fill: night ? "#2b4360" : "#83cbd8", transition: T }}
          />

          {/* Sliding knob (sun / moon) */}
          <g
            style={{
              transform: night ? "translate(28px, 2.333px)" : "translate(2.333px, 2.333px)",
              transition: T,
            }}
          >
            {/* Sun */}
            <g style={{ opacity: night ? 0 : 1, transition: T }}>
              <circle fill="#f8e664" r="15.167" cx="15.167" cy="15.167" />
              <circle fill="rgba(246,254,247,0.29)" r="11.667" cx="15.167" cy="15.167" />
              <circle fill="#fcf4b9" r="7" cx="15.167" cy="15.167" />
            </g>

            {/* Moon */}
            <g style={{ opacity: night ? 1 : 0, transition: T }}>
              <circle fill="#cce6ee" r="15.167" cx="15.167" cy="15.167" />
              <g fill="#a6cad0" transform="translate(-24.415 -1.009)">
                <circle transform="translate(43.009 4.496)" r="2" cy="2" cx="2" />
                <circle transform="translate(39.366 17.952)" r="2" cy="2" cx="2" />
                <circle transform="translate(33.016 8.044)" r="1" cy="1" cx="1" />
                <circle transform="translate(51.081 18.888)" r="1" cy="1" cx="1" />
                <circle transform="translate(33.016 22.503)" r="1" cy="1" cx="1" />
                <circle transform="translate(50.081 10.53)" r="1.5" cy="1.5" cx="1.5" />
              </g>
            </g>
          </g>

          {/* Cloud (day only) */}
          <g transform="translate(0 0)" style={{ opacity: night ? 0 : 1, transition: T }}>
            <path
              fill="#fff"
              transform="translate(-3466.47 -160.94)"
              d="M3512.81,173.815a4.463,4.463,0,0,1,2.243.62.95.95,0,0,1,.72-1.281,4.852,4.852,0,0,1,2.623.519c.034.02-.5-1.968.281-2.716a2.117,2.117,0,0,1,2.829-.274,1.821,1.821,0,0,1,.854,1.858c.063.037,2.594-.049,3.285,1.273s-.865,2.544-.807,2.626a12.192,12.192,0,0,1,2.278.892c.553.448,1.106,1.992-1.62,2.927a7.742,7.742,0,0,1-3.762-.3c-1.28-.49-1.181-2.65-1.137-2.624s-1.417,2.2-2.623,2.2a4.172,4.172,0,0,1-2.394-1.206,3.825,3.825,0,0,1-2.771.774c-3.429-.46-2.333-3.267-2.2-3.55A3.721,3.721,0,0,1,3512.81,173.815Z"
            />
          </g>

          {/* Stars (night only) */}
          <g fill="#def8ff" transform="translate(3.585 1.325)" style={{ opacity: night ? 1 : 0, transition: T }}>
            <path transform="matrix(-1, 0.017, -0.017, -1, 24.231, 3.055)" d="M.774,0,.566.559,0,.539.458.933.25,1.492l.485-.361.458.394L1.024.953,1.509.592.943.572Z" />
            <path transform="matrix(-0.777, 0.629, -0.629, -0.777, 23.185, 12.358)" d="M1.341.529.836.472.736,0,.505.46,0,.4.4.729l-.231.46L.605.932l.4.326L.9.786Z" />
            <path transform="matrix(0.438, 0.899, -0.899, 0.438, 23.177, 29.735)" d="M.015,1.065.475.9l.285.365L.766.772l.46-.164L.745.494.751,0,.481.407,0,.293.285.658Z" />
            <path transform="translate(12.677 0.388) rotate(104)" d="M1.161,1.6,1.059,1,1.574.722.962.607.86,0,.613.572,0,.457.446.881.2,1.454l.516-.274Z" />
            <path transform="matrix(-0.07, 0.998, -0.998, -0.07, 11.066, 15.457)" d="M.873,1.648l.114-.62L1.579.945,1.03.62,1.144,0,.706.464.157.139.438.7,0,1.167l.592-.083Z" />
            <path transform="translate(8.326 28.061) rotate(11)" d="M.593,0,.638.724,0,.982l.7.211.045.724.36-.64.7.211L1.342.935,1.7.294,1.063.552Z" />
            <path transform="translate(5.012 5.962) rotate(172)" d="M.816,0,.5.455,0,.311.323.767l-.312.455.516-.215.323.456L.827.911,1.343.7.839.552Z" />
            <path transform="translate(2.218 14.616) rotate(169)" d="M1.261,0,.774.571.114.3.487.967,0,1.538.728,1.32l.372.662.047-.749.728-.218L1.215.749Z" />
          </g>
        </g>
      </svg>
    </label>
  );
};
