/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import { Img, Section, Text } from 'npm:@react-email/components@0.0.22'

/**
 * Shared 50mm Retina World brand header for ALL transactional email
 * templates. Dark premium design matching the approved auth email
 * templates (GoTrue mailer_templates_*): a dark #0f172a card with the app
 * icon logo, "50mm Retina World" wordmark, "Compete · Learn · Create"
 * tagline, and a gold #c9a227 accent line beneath.
 *
 * Single source of truth for the header across every transactional email —
 * update here to restyle all of them at once.
 */
const LOGO_URL = 'https://50mmretina.com/images/icon-512x512.png'

export const BrandHeader: React.FC = () => (
  <Section style={card}>
    <Img
      src={LOGO_URL}
      alt="50mm Retina World"
      width="58"
      height="58"
      style={logo}
    />
    <Text style={wordmark}>50mm Retina World</Text>
    <Text style={tagline}>Compete &middot; Learn &middot; Create</Text>
  </Section>
)

const card: React.CSSProperties = {
  backgroundColor: '#0f172a',
  padding: '32px 24px 24px',
  textAlign: 'center',
  borderRadius: '12px',
  borderBottom: '3px solid #c9a227',
  marginBottom: '28px',
}

const logo: React.CSSProperties = {
  display: 'block',
  margin: '0 auto 12px',
  borderRadius: '13px',
  border: 0,
  outline: 'none',
}

const wordmark: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '19px',
  fontWeight: 600,
  letterSpacing: '0.4px',
  margin: '0',
  textAlign: 'center',
}

const tagline: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: '11px',
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  margin: '4px 0 0',
  textAlign: 'center',
}
