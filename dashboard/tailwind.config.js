/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    // Override default font sizes with design system scale
    fontSize: {
      xs:   ['10px', { lineHeight: '14px' }],
      sm:   ['12px', { lineHeight: '18px' }],
      base: ['14px', { lineHeight: '22px' }],
      lg:   ['16px', { lineHeight: '24px' }],
      xl:   ['18px', { lineHeight: '28px' }],
      '2xl': ['24px', { lineHeight: '32px' }],
      '3xl': ['30px', { lineHeight: '36px' }],
    },
    // Override border-radius for Notion/Tally feel
    borderRadius: {
      none: '0',
      sm:   '4px',
      DEFAULT: '6px',
      md:   '6px',
      lg:   '8px',
      xl:   '8px',
      full: '9999px',
    },
    extend: {
      fontFamily: {
        sans: [
          '"Pretendard Variable"',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          '"Helvetica Neue"',
          'sans-serif',
        ],
      },
      colors: {
        // -- Text (Ink) --
        ink: {
          DEFAULT:   '#111111',
          secondary: '#505050',
          tertiary:  '#767676',
        },
        // -- Backgrounds (Surface) --
        surface: {
          DEFAULT: '#FFFFFF',
          page:    '#F7F7FB',
          panel:   '#F1F1F5',
        },
        // -- Borders (Line) --
        line: {
          light:   '#F0F0F6',
          DEFAULT: '#E5E5EC',
          heavy:   '#111111',
        },
        // -- Brand --
        brand: {
          DEFAULT: '#3366FF',
          light:   '#EBF0FF',
        },
        // -- Semantic Status --
        positive: {
          DEFAULT: '#065F46',
          bg:      '#ECFDF5',
        },
        negative: {
          DEFAULT: '#991B1B',
          bg:      '#FEF2F2',
        },
        caution: {
          DEFAULT: '#92400E',
          bg:      '#FFFBEB',
        },
      },
      boxShadow: {
        sm:    '0 1px 2px rgba(0,0,0,0.04)',
        DEFAULT: '0 1px 3px rgba(0,0,0,0.06)',
        md:    '0 2px 8px rgba(0,0,0,0.08)',
        modal: '0 8px 30px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
}
