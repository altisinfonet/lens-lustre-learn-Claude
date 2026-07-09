import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
  	container: {
  		center: true,
  		padding: '0rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			}
  		},
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		height: {
  			'screen-safe': '100dvh'
  		},
  		minHeight: {
  			'screen-safe': '100dvh'
  		},
  		keyframes: {
  			'accordion-down': {
  				from: { height: '0' },
  				to: { height: 'var(--radix-accordion-content-height)' }
  			},
  			'accordion-up': {
  				from: { height: 'var(--radix-accordion-content-height)' },
  				to: { height: '0' }
  			},
  			'photo-reveal': {
  				'0%': { opacity: '0', filter: 'blur(8px)', transform: 'scale(0.96)' },
  				'100%': { opacity: '1', filter: 'blur(0)', transform: 'scale(1)' }
  			},
  			'badge-pop': {
  				'0%': { opacity: '0', transform: 'scale(0)' },
  				'70%': { opacity: '1', transform: 'scale(1.15)' },
  				'100%': { opacity: '1', transform: 'scale(1)' }
  			},
  			'ripple': {
  				'0%': { transform: 'scale(0)', opacity: '0.55' },
  				'100%': { transform: 'scale(2.4)', opacity: '0' }
  			},
  			'shimmer': {
  				'0%': { transform: 'translateX(-120%)' },
  				'100%': { transform: 'translateX(120%)' }
  			},
  			'glow-pulse': {
  				'0%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0.55)' },
  				'70%': { boxShadow: '0 0 0 10px hsl(var(--primary) / 0)' },
  				'100%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0)' }
  			},
  			'slide-in-from-right': {
  				'0%': { opacity: '0', transform: 'translateX(24px)' },
  				'100%': { opacity: '1', transform: 'translateX(0)' }
  			},
  			'slide-in-from-left': {
  				'0%': { opacity: '0', transform: 'translateX(-24px)' },
  				'100%': { opacity: '1', transform: 'translateX(0)' }
  			}
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'photo-reveal': 'photo-reveal 0.5s cubic-bezier(0.16, 1, 0.3, 1) both',
  			'badge-pop': 'badge-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both',
  			'ripple': 'ripple 0.55s ease-out forwards',
  			'shimmer': 'shimmer 2.4s ease-in-out infinite',
  			'glow-pulse': 'glow-pulse 0.9s ease-out',
  			'slide-in-from-right': 'slide-in-from-right 0.32s cubic-bezier(0.16, 1, 0.3, 1) both',
  			'slide-in-from-left': 'slide-in-from-left 0.32s cubic-bezier(0.16, 1, 0.3, 1) both'
  		},
  		fontFamily: {
  			sans: [
  				'Inter',
  				'ui-sans-serif',
  				'system-ui',
  				'-apple-system',
  				'BlinkMacSystemFont',
  				'Segoe UI',
  				'Roboto',
  				'Helvetica Neue',
  				'Arial',
  				'Noto Sans',
  				'sans-serif'
  			],
  			serif: [
  				'Lora',
  				'ui-serif',
  				'Georgia',
  				'Cambria',
  				'Times New Roman',
  				'Times',
  				'serif'
  			],
  			mono: [
  				'Space Mono',
  				'ui-monospace',
  				'SFMono-Regular',
  				'Menlo',
  				'Monaco',
  				'Consolas',
  				'Liberation Mono',
  				'Courier New',
  				'monospace'
  			]
  		},
  		boxShadow: {
  			'2xs': 'var(--shadow-2xs)',
  			xs: 'var(--shadow-xs)',
  			sm: 'var(--shadow-sm)',
  			md: 'var(--shadow-md)',
  			lg: 'var(--shadow-lg)',
  			xl: 'var(--shadow-xl)',
  			'2xl': 'var(--shadow-2xl)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
