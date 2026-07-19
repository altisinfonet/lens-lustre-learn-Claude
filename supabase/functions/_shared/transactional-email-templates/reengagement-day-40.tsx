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
  activeCompetitions?: number
}

// Day-40 — Low-pressure creative nudge (one photo)
const Email = ({ participantName, activeCompetitions = 0 }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>One photo. That's all it takes to come back.</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Text style={kicker}>· A small challenge ·</Text>
        <Heading style={h1}>One photo{participantName ? `, ${participantName}` : ''}. That's all.</Heading>
        <Text style={text}>
          No streak to rebuild. No catching up. Just one frame — something you saw today, the light in your kitchen, a face, a street.
        </Text>
        <Text style={text}>
          Post it, and you're back. That's genuinely the whole challenge.
        </Text>
        {activeCompetitions > 0 && (
          <Section style={statBox}>
            <Text style={statLine}>
              And if you want a reason: there are <strong>{activeCompetitions}</strong> open competitions right now where that one photo could win something.
            </Text>
          </Section>
        )}
        <Section style={ctaSection}>
          <Button href={`${SITE_URL}/feed`} style={button}>Share One Photo</Button>
        </Section>
        <Text style={ps}>
          Rather not get these? <a href={`${SITE_URL}/notifications`} style={link}>Adjust your email preferences</a> — no hard feelings.
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
  subject: 'One photo. That\'s all it takes · 50mm Retina World',
  displayName: 'Re-engagement · Day 40 (one-photo nudge)',
  previewData: { participantName: 'Alex', activeCompetitions: 5 },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const kicker: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.2em', color: '#0284c7', textTransform: 'uppercase', fontWeight: 600, margin: '0 0 10px' }
const h1: React.CSSProperties = { fontSize: '24px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 18px', lineHeight: 1.35 }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: 1.7, color: '#333', margin: '0 0 16px' }
const statBox: React.CSSProperties = { backgroundColor: '#f8fafc', padding: '18px 22px', borderRadius: '10px', margin: '22px 0' }
const statLine: React.CSSProperties = { fontSize: '14px', color: '#0a0a0a', margin: '2px 0', lineHeight: 1.6 }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0 16px' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#fff', padding: '14px 34px', fontSize: '14px', fontWeight: 600, textDecoration: 'none', borderRadius: '8px' }
const link: React.CSSProperties = { color: '#0284c7', textDecoration: 'underline' }
const ps: React.CSSProperties = { fontSize: '12px', color: '#666', margin: '18px 0 0' }
const hr: React.CSSProperties = { borderColor: '#eee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999' }
