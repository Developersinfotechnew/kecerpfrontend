'use client';

import { useState } from 'react';

/**
 * Password input with a show/hide toggle.
 *
 * Every password field in the app must use this component rather than a raw
 * `<input type="password">`. The toggle is the only difference from a normal
 * input, but centralising it means the accessible wiring (aria-label, the
 * pressed state, the focus ring) is written once and cannot drift between
 * pages.
 */

interface PasswordFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;

  /** Shown on the label. The input also gets this as aria-label when set. */
  label?: string;

  /** Passed to the browser so password managers fill the right field. */
  autoComplete?: string;

  required?: boolean;
  disabled?: boolean;
  placeholder?: string;

  /** Extra classes for the wrapper, not the input. */
  className?: string;
}

const INPUT_CLASS =
  'block w-full rounded-md border border-slate-300 px-3 py-2 pr-10 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';

export function PasswordField({
  id,
  value,
  onChange,
  label,
  autoComplete = 'current-password',
  required,
  disabled,
  placeholder,
  className,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={className}>
      {label ? (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
      ) : null}

      <div className="relative mt-1">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
          aria-label={label}
        />

        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // Announce the state change and give the button a name. Without this
          // a screen reader reads only "button".
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          disabled={disabled}
          // Keep the toggle out of the tab order trap: it still focusable, but
          // a mouse click on the icon must not blur the input and trigger
          // validation before the user has finished typing.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-500 hover:text-slate-700 disabled:opacity-50"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
