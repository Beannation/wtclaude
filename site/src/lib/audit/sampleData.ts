/**
 * The demo dataset — a verbatim copy of seat-audit-fixtures/spend-report-export-sample.csv
 * ("Acme Robotics", 13 users / 24 seats). Used for the ungated "try sample" headline, the
 * email-gated demo report, and the static /business/audit/sample page. ALWAYS rendered with
 * the SAMPLE banner + watermark + SAMPLE- download — never allowed to read as the user's data.
 */
export const SAMPLE_ORG = 'Acme Robotics';
export const SAMPLE_SEAT_COUNT = 24;

export const SAMPLE_CSV = `email,account_uuid,product,model,model_family,total_requests,total_prompt_tokens,total_completion_tokens,total_net_spend_usd,total_gross_spend_usd
alice@acme.com,u_7995,Claude Code,claude-opus-4-6,Opus,1180,41200000,3900000,1368.84,1610.4
alice@acme.com,u_7995,Claude Code,claude-sonnet-4-6,Sonnet,320,9800000,1100000,178.58,210.1
alice@acme.com,u_7995,Claude Code,claude-3-5-haiku,Haiku,90,980000,120000,16.76,19.72
bob@acme.com,u_8287,Claude Code,claude-sonnet-4-6,Sonnet,720,21000000,2400000,697.17,820.2
bob@acme.com,u_8287,Claude Code,claude-opus-4-6,Opus,110,3100000,300000,136.2,160.24
carol@acme.com,u_4589,Chat,claude-sonnet-4-6,Sonnet,410,5200000,900000,102.0,120.0
carol@acme.com,u_4589,Cowork,claude-sonnet-4-6,Sonnet,130,3900000,600000,85.0,100.0
dave@acme.com,u_3083,Office Agents,claude-sonnet-4-6,Sonnet,260,4100000,700000,120.7,142.0
erin@acme.com,u_7563,Claude Code,claude-sonnet-4-6,Sonnet,380,8800000,1000000,204.0,240.0
erin@acme.com,u_7563,Claude Code,claude-opus-4-6,Opus,95,2400000,250000,144.5,170.0
frank@acme.com,u_8201,Chat,claude-opus-4-6,Opus,220,5900000,800000,255.0,300.0
grace@acme.com,u_7366,Chat,claude-3-5-haiku,Haiku,14,120000,18000,2.63,3.1
ivan@devshop.io,u_5482,Claude Code,claude-opus-4-6,Opus,410,11000000,1200000,552.5,650.0
judy@devshop.io,u_1938,Claude Code,claude-sonnet-4-6,Sonnet,150,3200000,380000,102.0,120.0
ken@acme.com,u_3936,Cowork,claude-sonnet-4-6,Sonnet,300,7400000,1050000,238.0,280.0
laura@acme.com,u_9475,Claude Code,claude-opus-4-6,Opus,40,9900000,900000,442.0,520.0
mike@acme.com,u_6482,Chat,claude-3-5-haiku,Haiku,300,1100000,160000,12.75,15.0
nina@acme.com,u_4419,Claude Code,claude-sonnet-4-6,Sonnet,240,5600000,720000,161.5,190.0
`;
