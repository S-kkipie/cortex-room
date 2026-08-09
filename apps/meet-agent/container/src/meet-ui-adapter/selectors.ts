// The ONLY place Meet DOM selectors live. Verified/adjusted against a live
// Meet page in Task 10. Values here are best-known starting points.
export const selectors = {
    nameInput: 'input[aria-label*="name" i]',
    askToJoinButton: 'button[jsname][aria-label*="join" i], button:has-text("Ask to join")',
    participantTile: "[data-participant-id]",
    participantIdAttr: "data-participant-id",
    participantName: "[data-self-name], .participant-name",
    activeSpeakerMarker: '[data-is-speaking="true"], .speaking',
    leaveButton: 'button[aria-label*="leave" i]',
} as const;
