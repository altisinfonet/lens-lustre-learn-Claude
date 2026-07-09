/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body, Button, Container, Head, Heading, Html, Img, Link, Preview, Text,
} from 'npm:@react-email/components@0.0.22'

interface InviteEmailProps { siteName: string; siteUrl: string; confirmationUrl: string }

const LOGO_URL = 'https://isywidnfnjhtydmdfgtk.supabase.co/storage/v1/object/public/email-assets/logo.png'

export const InviteEmail = ({ siteName, siteUrl, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to join {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} alt={siteName} width="48" height="48" style={logo} />
        <Heading style={h1}>You've Been Invited</Heading>
        <Text style={text}>
          You've been invited to join <Link href={siteUrl} style={link}><strong>{siteName}</strong></Link>. Click the button below to accept.
        </Text>
        <Button style={button} href={confirmationUrl}>Accept Invitation</Button>
        <Text style={footer}>If you weren't expecting this invitation, you can safely ignore this email.</Text>
              <Text style={disclaimer}>This is an automated message from <strong>50mm Retina World</strong>. Please do not reply — this inbox is not monitored.</Text>
        <Text style={disclaimer}>Need help or spotted an issue? Sign in to your account and raise a support ticket from the <strong>Help &amp; Support</strong> section — our team will get back to you as quickly as possible.</Text>
        </Container>
    </Body>
  </Html>
)

export default InviteEmail

const main = { backgroundColor: '#ffffff', fontFamily: 'Helvetica, Arial, sans-serif' }
const container = { padding: '40px 25px' }
const logo = { margin: '0 0 24px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a1f2e', margin: '0 0 20px', letterSpacing: '-0.01em' }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.6', margin: '0 0 25px' }
const link = { color: '#0ea5e9', textDecoration: 'underline' }
const button = { backgroundColor: '#0ea5e9', color: '#0c2d3f', fontSize: '13px', fontWeight: 'bold' as const, borderRadius: '0px', padding: '14px 28px', textDecoration: 'none', letterSpacing: '0.05em', textTransform: 'uppercase' as const }
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
const disclaimer = { fontSize: '11px', color: '#9ca3af', lineHeight: '1.6', margin: '16px 0 0' }
