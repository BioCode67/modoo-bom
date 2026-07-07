/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        // 모두봄 카툰 팔레트 — 봄/새싹 테마
        sprout: {
          50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac',
          400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d',
          800: '#166534', 900: '#14532d',
        },
        // 상태 의미색(성공) — KRDS처럼 브랜드(블루)와 분리해 '충족·완료·수급'은 초록으로 표현.
        success: {
          50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac',
          400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d',
        },
        peach: {
          50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74',
          400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412',
        },
        sky2: {
          50: '#eff9ff', 100: '#dcf2ff', 200: '#b3e6ff', 300: '#7ad4ff',
          400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7',
          // 700/800: 밝은 배경 텍스트 대비(WCAG AA) 확보용 — 흰 배경에서 sky2-600(4.09:1)은 미달, 700(5.93:1) 통과.
          700: '#0369a1', 800: '#075985',
        },
        sun: {
          100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308',
        },
        cream: '#fffaf3',
      },
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        round: ['Pretendard Variable', 'Pretendard', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        blob: '42% 58% 63% 37% / 41% 44% 56% 59%',
      },
      boxShadow: {
        soft: '0 8px 30px -8px rgba(34, 139, 87, 0.18)',
        pop: '0 10px 0 0 rgba(0,0,0,0.06)',
        cute: '0 12px 40px -12px rgba(249, 115, 22, 0.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(10px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'fade-in-scale': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(20px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        'float-slow': { '0%,100%': { transform: 'translateY(0) rotate(-2deg)' }, '50%': { transform: 'translateY(-16px) rotate(2deg)' } },
        wiggle: { '0%,100%': { transform: 'rotate(-3deg)' }, '50%': { transform: 'rotate(3deg)' } },
        'bounce-in': { '0%': { transform: 'scale(0.8)', opacity: '0' }, '60%': { transform: 'scale(1.05)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        blob: {
          '0%,100%': { borderRadius: '42% 58% 63% 37% / 41% 44% 56% 59%' },
          '50%': { borderRadius: '58% 42% 37% 63% / 56% 59% 41% 44%' },
        },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
        'spin-slow': { from: { transform: 'rotate(0)' }, to: { transform: 'rotate(360deg)' } },
        twinkle: { '0%,100%': { opacity: '0.3', transform: 'scale(0.8)' }, '50%': { opacity: '1', transform: 'scale(1.1)' } },
      },
      animation: {
        'fade-in': 'fade-in 0.5s ease-out forwards',
        'fade-in-scale': 'fade-in-scale 0.35s ease-out forwards',
        'slide-up': 'slide-up 0.5s ease-out forwards',
        float: 'float 4s ease-in-out infinite',
        'float-slow': 'float-slow 7s ease-in-out infinite',
        wiggle: 'wiggle 0.6s ease-in-out',
        'bounce-in': 'bounce-in 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards',
        blob: 'blob 8s ease-in-out infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
        twinkle: 'twinkle 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
