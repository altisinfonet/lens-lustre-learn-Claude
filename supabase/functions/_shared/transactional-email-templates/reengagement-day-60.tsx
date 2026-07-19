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

// Day-60 — Final farewell (last in the series)
const Email = ({ participantName }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>One last frame before we go quiet.</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Text style={kicker}>· The Last Letter ·</Text>
        <Heading style={h1}>One last frame{participantName ? `, ${participantName}` : ''}.</Heading>
        <Text style={text}>
          This is the final message in this series. We won't keep nudging your inbox — your time is yours.
        </Text>
        <Text style={text}>
          But the door stays open. Your profile, your photos, your friends, your earnings — all still here when you're ready.
        </Text>
        <Section style={quoteBox}>
          <Text style={quote}>
            "You don't take a photograph, you make it."
          </Text>
          <Text style={attribution}>— Ansel Adams</Text>
        </Section>
        <Section style={ctaSection}>
          <Button href={`${SITE_URL}/feed`} style={button}>Make One More</Button>
        </Section>
        <Text style={footerNote}>
          We'll be here. No pressure. No more emails like this.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>— {SITE_NAME}</Text>
              <Disclaimer />
        </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: 'One last frame before we go quiet · 50mm Retina World',
  displayName: 'Re-engagement · Day 60 (final farewell)',
  previewData: { participantName: 'Alex' },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: 'Georgia, "Times New Roman", serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '40px 28px' }
const kicker: React.CSSProperties = { fontSize: '11px', letterSpacing: '0.3em', color: '#999', textTransform: 'uppercase', margin: '0 0 14px', textAlign: 'center' }
const h1: React.CSSProperties = { fontSize: '28px', fontWeight: 400, color: '#0a0a0a', margin: '0 0 22px', lineHeight: 1.3, textAlign: 'center', fontStyle: 'italic' }
const text: React.CSSProperties = { fontSize: '16px', lineHeight: 1.7, color: '#333', margin: '0 0 16px' }
const quoteBox: React.CSSProperties = { textAlign: 'center', margin: '32px 0', padding: '20px 0', borderTop: '1px solid #eee', borderBottom: '1px solid #eee' }
const quote: React.CSSProperties = { fontSize: '18px', fontStyle: 'italic', color: '#0a0a0a', margin: '0 0 6px' }
const attribution: React.CSSProperties = { fontSize: '12px', color: '#999', letterSpacing: '0.1em' }
const ctaSection: React.CSSProperties = { textAlign: 'center', margin: '32px 0 20px' }
const button: React.CSSProperties = { backgroundColor: '#0a0a0a', color: '#fff', padding: '14px 36px', fontSize: '13px', fontWeight: 600, textDecoration: 'none', borderRadius: '2px', textTransform: 'uppercase', letterSpacing: '0.15em' }
const footerNote: React.CSSProperties = { fontSize: '13px', color: '#666', textAlign: 'center', fontStyle: 'italic', margin: '16px 0 0' }
const hr: React.CSSProperties = { borderColor: '#eee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '11px', color: '#999', letterSpacing: '0.1em', textTransform: 'uppercase', textAlign: 'center' }
