// RC SHAPE FIXTURE — real specifiers from a42b209e, body elided. See 09_rc_regression.sh header.
// Real file: 130 lines, 5646 bytes.
import * as React from "npm:react@18.3.1";
import {
  Body,
  Container,
  Heading,
  Text,
} from "npm:@react-email/components@0.0.22";
import { BrandHeader } from "./BrandHeader.tsx";
import { Disclaimer } from "./Disclaimer.tsx";
import { registry } from "./registry.ts";
import { stageCatalog } from "../stageCatalog.ts";
import { laneConfig } from "../laneConfig.ts";

/* body elided */
export default function EntryWinner() {
  return (
    <Body>
      <Container>
        <BrandHeader />
        <Heading>{registry.winner}</Heading>
        <Text>{stageCatalog.final} {laneConfig.publicUrl}</Text>
        <Disclaimer />
      </Container>
    </Body>
  );
}
