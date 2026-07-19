import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = '50mm Retina World'
const SITE_URL = 'https://www.50mmretina.com'

interface Props {
  participantName?: string
}

// Day-50 — Reassurance: your spot, profile and earnings are intact
const Email = ({ participantName }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your spot is still here — nothing's been lost.</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Text style={kicker}>· Still yours ·</Text>
        <Heading style={h1}>Your spot is still here{participantName ? `, ${participantName}` : ''}.</Heading>
        <Text style={text}>
          It's been a while, so we wanted to reassure you: nothing has been lost. Everything you built on {SITE_NAME} is safe and waiting.
        </Text>
        <Section style={statBox}>
          <Text style={statLine}>✓ Your profile and portfolio are intact</Text>
          <Text style={statLine}>✓ Your photos, posts and comments are all still there</Text>
          <Text style={statLine}>✓ Your wallet, rewards and certificates are untouched</Text>
          <Text style={statLine}>✓ The people you follow are still here too</Text>
        </Section>
        <Text style={text}>
          Whenever you're ready, you can pick up exactly where you left off — no setup, no starting over.
        </Text>
        <Section style={ctaSection}>
          <Button href={`${SITE_URL}/feed`} style={button}>Pick Up Where You Left Off</Button>
        </Section>
        <Text style={ps}>
          Want to change how often we email you? <a href={`${SITE_URL}/notifications`} style={link}>Manage preferences</a>.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>— The {SITE_NAME} Team</Text>
              <Disclaimer />
        </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Record<string, any>) => `Your spot is still here${d?.participantName ? `, ${d.participantName}` : ''} · 50mm Retina World`,
  displayName: 'Re-engagement · Day 50 (reassurance)',
  previewData: { participantName: 'Alex' },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const kicker: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.2em', color: '#0284c7', textTransform: 'uppercase', fontWeight: 600, margin: '0 0 10px' }
const h1: React.CSSProperties = { fontSize: '23px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 18px', lineHeight: 1.35 }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: 1.7, color: '#333', margin: '0 0 16px' }
const statBox: React.CSSProperties = { backgroundColor: '#f8fafc', padding: '20px 24px', borderRadius: '10px', margin: '22px 0' }
const statLine: React.CSSProperties = { fontSize: '14px', color: '#0a0a0a', margin: '6px 0' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0 16px' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#fff', padding: '14px 32px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', borderRadius: '8px' }
const link: React.CSSProperties = { color: '#0284c7', textDecoration: 'underline' }
const ps: React.CSSProperties = { fontSize: '12px', color: '#666', margin: '18px 0 0' }
const hr: React.CSSProperties = { borderColor: '#eee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999' }
