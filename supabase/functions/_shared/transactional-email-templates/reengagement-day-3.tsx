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

// Day-3 — Poetic editorial
const Email = ({ participantName, newPostsCount = 0, activeCompetitions = 0, friendsActive = 0 }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your frame is empty without you.</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Text style={kicker}>· Day 3 ·</Text>
        <Heading style={h1}>Your frame is empty without you{participantName ? `, ${participantName}` : ''}.</Heading>
        <Text style={text}>
          The light has shifted. The street has stories. Somewhere a shutter waits for you to release it.
        </Text>
        <Text style={text}>
          We noticed your absence — and so did the community you build with.
        </Text>
        <Section style={statBox}>
          {newPostsCount > 0 && <Text style={statLine}><strong>{newPostsCount}</strong> new posts since you left</Text>}
          {friendsActive > 0 && <Text style={statLine}><strong>{friendsActive}</strong> friends were active today</Text>}
          {activeCompetitions > 0 && <Text style={statLine}><strong>{activeCompetitions}</strong> live competitions waiting</Text>}
        </Section>
        <Section style={ctaSection}>
          <Button href={`${SITE_URL}/feed`} style={button}>Return to the Frame</Button>
        </Section>
        <Hr style={hr} />
        <Text style={footer}>— {SITE_NAME}</Text>
              <Disclaimer />
        </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'Your frame is empty without you · 50mm Retina World',
  displayName: 'Re-engagement · Day 3 (poetic)',
  previewData: { participantName: 'Alex', newPostsCount: 42, activeCompetitions: 3, friendsActive: 8 },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Times New Roman", serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const kicker: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.3em', color: '#999', textTransform: 'uppercase', margin: '0 0 12px' }
const h1: React.CSSProperties = { fontSize: '26px', fontWeight: 400, color: '#0a0a0a', margin: '0 0 20px', lineHeight: 1.3, fontStyle: 'italic' }
const text: React.CSSProperties = { fontSize: '16px', lineHeight: 1.7, color: '#333', margin: '0 0 16px' }
const statBox: React.CSSProperties = { backgroundColor: '#fafafa', padding: '20px 24px', borderLeft: '3px solid #0a0a0a', margin: '24px 0' }
const statLine: React.CSSProperties = { fontSize: '14px', color: '#333', margin: '4px 0', fontFamily: '-apple-system, sans-serif' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '32px 0 20px' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#fff', padding: '14px 32px', fontSize: '13px', fontWeight: 600, textDecoration: 'none', borderRadius: '2px', textTransform: 'uppercase', letterSpacing: '0.15em' }
const hr: React.CSSProperties = { borderColor: '#eee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '11px', color: '#999', letterSpacing: '0.1em', textTransform: 'uppercase' }
