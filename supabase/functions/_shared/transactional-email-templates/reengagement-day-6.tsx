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
  newPostsCount?: number
  activeCompetitions?: number
  friendsActive?: number
}

// Day-6 — Playful
const Email = ({ participantName, newPostsCount = 0, activeCompetitions = 0, friendsActive = 0 }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your shutter is collecting dust 📸</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Text style={kicker}>📸 Day 6 of radio silence</Text>
        <Heading style={h1}>Your shutter is collecting dust{participantName ? `, ${participantName}` : ''}!</Heading>
        <Text style={text}>
          We checked — your camera is plotting an escape. Your lens cap is winning. The dust bunnies have formed a union.
        </Text>
        <Text style={text}>
          Here's what you've missed in just <strong>6 days</strong>:
        </Text>
        <Section style={statBox}>
          {newPostsCount > 0 && <Text style={statLine}>🔥 <strong>{newPostsCount}</strong> fresh shots dropped on the feed</Text>}
          {friendsActive > 0 && <Text style={statLine}>👋 <strong>{friendsActive}</strong> friends asking where you went</Text>}
          {activeCompetitions > 0 && <Text style={statLine}>🏆 <strong>{activeCompetitions}</strong> competitions still open for entries</Text>}
          <Text style={statLine}>☕️ <strong>0</strong> excuses left</Text>
        </Section>
        <Section style={ctaSection}>
          <Button href={`${SITE_URL}/feed`} style={button}>Dust Off The Shutter →</Button>
        </Section>
        <Text style={ps}>P.S. Your followers refreshed their feed 47 times today. Not exaggerating. Slightly.</Text>
        <Hr style={hr} />
        <Text style={footer}>— {SITE_NAME}</Text>
              <Disclaimer />
        </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'Your shutter is collecting dust 📸 · 50mm Retina World',
  displayName: 'Re-engagement · Day 6 (playful)',
  previewData: { participantName: 'Alex', newPostsCount: 87, activeCompetitions: 4, friendsActive: 12 },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const kicker: React.CSSProperties = { fontSize: '12px', color: '#f59e0b', fontWeight: 600, margin: '0 0 8px' }
const h1: React.CSSProperties = { fontSize: '24px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 16px', lineHeight: 1.3 }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: 1.6, color: '#333', margin: '0 0 14px' }
const statBox: React.CSSProperties = { backgroundColor: '#fffbeb', padding: '18px 22px', borderRadius: '10px', margin: '20px 0' }
const statLine: React.CSSProperties = { fontSize: '14px', color: '#333', margin: '6px 0' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '28px 0 16px' }
const button: React.CSSProperties = { backgroundColor: '#f59e0b', color: '#0a0a0a', padding: '14px 30px', fontSize: '14px', fontWeight: 700, textDecoration: 'none', borderRadius: '8px' }
const ps: React.CSSProperties = { fontSize: '13px', color: '#666', fontStyle: 'italic', margin: '20px 0 0' }
const hr: React.CSSProperties = { borderColor: '#eee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999' }
