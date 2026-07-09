import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import { BrandHeader } from './BrandHeader.tsx'
import { Disclaimer } from './Disclaimer.tsx'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = '50mm Retina World'

interface Props {
  participantName?: string
  certificateTitle?: string
  competitionTitle?: string
  revokedReason?: string
}

const CertificateRevokedEmail = ({
  participantName, certificateTitle, competitionTitle, revokedReason,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>An update about a certificate previously issued to you</Preview>
    <Body style={main}>
      <Container style={container}>
        <BrandHeader />
        <Heading style={h1}>{participantName ? `Hi ${participantName},` : 'Hi,'}</Heading>
        <Text style={label}>Certificate Status Update</Text>
        <Text style={text}>
          We're writing to let you know that the certificate
          {certificateTitle ? <> <strong>"{certificateTitle}"</strong></> : null}
          {competitionTitle ? <> for <strong>{competitionTitle}</strong></> : null}{' '}
          previously issued to you has been <strong>revoked</strong>.
        </Text>
        <Section style={reasonBox}>
          <Text style={reasonLabel}>Reason</Text>
          <Text style={reasonText}>
            {revokedReason ?? 'Under our updated competition policy, certificates are issued exclusively for Round 4 awards. This certificate predates that policy.'}
          </Text>
        </Section>
        <Text style={text}>
          This change reflects a clarification of our awards policy and is not
          a reflection on your work or participation. Your contribution to the
          {SITE_NAME ? ` ${SITE_NAME} ` : ' '}community is genuinely appreciated,
          and we hope you'll continue to take part in upcoming rounds.
        </Text>
        <Text style={text}>
          If you believe this revocation was made in error, please reply to this
          email and our team will review your case.
        </Text>
        <Hr style={hr} />
        <Text style={footer}>— The {SITE_NAME} Team</Text>
              <Disclaimer />
        </Container>
    </Body>
  </Html>
)

export const template = {
  component: CertificateRevokedEmail,
  subject: (d: Record<string, any>) =>
    `Certificate revoked${d?.certificateTitle ? ` — "${d.certificateTitle}"` : ''} — ${SITE_NAME}`,
  displayName: 'Certificate revoked',
  previewData: {
    participantName: 'Alex',
    certificateTitle: 'Winner Certificate',
    competitionTitle: 'Street Photography 2026',
    revokedReason: 'Ruleset v4: certificates are issued exclusively in Round 4. This certificate predates the policy and has been revoked.',
  },
} satisfies TemplateEntry

const main: React.CSSProperties = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container: React.CSSProperties = { maxWidth: '560px', margin: '0 auto', padding: '32px 28px' }
const h1: React.CSSProperties = { fontSize: '22px', fontWeight: 700, color: '#0a0a0a', margin: '0 0 8px' }
const label: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 16px' }
const text: React.CSSProperties = { fontSize: '15px', lineHeight: '1.6', color: '#333333', margin: '0 0 18px' }
const reasonBox: React.CSSProperties = { backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '16px 18px', margin: '0 0 22px' }
const reasonLabel: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 6px' }
const reasonText: React.CSSProperties = { fontSize: '14px', lineHeight: '1.55', color: '#1f2937', margin: '0' }
const hr: React.CSSProperties = { borderColor: '#eeeeee', margin: '28px 0 16px' }
const footer: React.CSSProperties = { fontSize: '12px', color: '#999999', margin: '0' }
