#!/usr/bin/env python3
"""
Cost model for the full Claude Usage Estimator at different user volumes.
Includes: Claude API, infrastructure, email, monitoring.
"""

# === CONSTANTS ===

# Claude API pricing (Sonnet 4.6)
SONNET_INPUT_PER_MTOK = 3.00
SONNET_OUTPUT_PER_MTOK = 15.00
HAIKU_INPUT_PER_MTOK = 1.00
HAIKU_OUTPUT_PER_MTOK = 5.00

# Per-estimate token usage
SYSTEM_PROMPT_TOKENS = 1500  # cacheable
PROJECT_DESC_TOKENS = 500     # unique per request
OUTPUT_TOKENS = 750            # structured JSON response

# Cache pricing (10% of base for reads)
CACHE_READ_DISCOUNT = 0.10
CACHE_WRITE_MULTIPLIER = 1.25  # 5-min TTL

# Usage patterns
AVG_ESTIMATES_PER_USER_PER_MONTH = 3  # conservative
RE_ESTIMATES_PER_CHANGE = 0.5  # not everyone re-estimates
ANTHROPIC_CHANGES_PER_MONTH = 0.75  # roughly every 5-6 weeks

# Infrastructure
SUPABASE_FREE_LIMIT_USERS = 2000
SUPABASE_PRO_MONTHLY = 25
SUPABASE_TEAM_MONTHLY = 599
VERCEL_PRO_MONTHLY = 20
CHANGEDETECTION_VPS = 5
DOMAIN_YEARLY = 15

# Email (Resend pricing)
RESEND_FREE_EMAILS = 3000
RESEND_PAID_MONTHLY = 20  # 50K emails
RESEND_SCALE_MONTHLY = 75  # 250K emails
EMAILS_PER_USER_PER_MONTH = 1.5  # nudges + notifications

# Tracker infrastructure (from earlier analysis, per-user-month data)
TRACKER_DATA_PER_USER_DAY_KB = 5  # aggregated summaries
TRACKER_EDGE_CALLS_PER_USER_DAY = 10  # syncs

def cost_per_estimate_sonnet(cached=True):
    """Cost of one estimation call using Sonnet 4.6"""
    if cached:
        input_cost = (
            SYSTEM_PROMPT_TOKENS * SONNET_INPUT_PER_MTOK * CACHE_READ_DISCOUNT / 1_000_000 +
            PROJECT_DESC_TOKENS * SONNET_INPUT_PER_MTOK / 1_000_000
        )
    else:
        input_cost = (SYSTEM_PROMPT_TOKENS + PROJECT_DESC_TOKENS) * SONNET_INPUT_PER_MTOK / 1_000_000
    
    output_cost = OUTPUT_TOKENS * SONNET_OUTPUT_PER_MTOK / 1_000_000
    return input_cost + output_cost

def cost_per_estimate_haiku(cached=True):
    """Cost of one estimation call using Haiku 4.5"""
    if cached:
        input_cost = (
            SYSTEM_PROMPT_TOKENS * HAIKU_INPUT_PER_MTOK * CACHE_READ_DISCOUNT / 1_000_000 +
            PROJECT_DESC_TOKENS * HAIKU_INPUT_PER_MTOK / 1_000_000
        )
    else:
        input_cost = (SYSTEM_PROMPT_TOKENS + PROJECT_DESC_TOKENS) * HAIKU_INPUT_PER_MTOK / 1_000_000
    
    output_cost = OUTPUT_TOKENS * HAIKU_OUTPUT_PER_MTOK / 1_000_000
    return input_cost + output_cost

def infra_cost(monthly_active_users):
    """Infrastructure cost per month"""
    mau = monthly_active_users
    
    # Supabase
    if mau <= SUPABASE_FREE_LIMIT_USERS:
        supabase = 0
    elif mau <= 50_000:
        supabase = SUPABASE_PRO_MONTHLY
        # Add egress overages for larger tiers
        gb_egress = mau * TRACKER_DATA_PER_USER_DAY_KB * 30 / 1_000_000  # GB/month
        if gb_egress > 250:
            supabase += (gb_egress - 250) * 0.09
    else:
        supabase = SUPABASE_TEAM_MONTHLY
    
    # Vercel (need Pro for commercial use)
    vercel = VERCEL_PRO_MONTHLY if mau > 0 else 0
    
    # Change detection
    monitoring = CHANGEDETECTION_VPS
    
    # Domain (amortized monthly)
    domain = DOMAIN_YEARLY / 12
    
    return {
        'supabase': round(supabase, 2),
        'vercel': vercel,
        'monitoring': monitoring,
        'domain': round(domain, 2),
        'total': round(supabase + vercel + monitoring + domain, 2)
    }

def email_cost(monthly_active_users):
    """Email notification cost per month"""
    emails = monthly_active_users * EMAILS_PER_USER_PER_MONTH
    if emails <= RESEND_FREE_EMAILS:
        return 0
    elif emails <= 50_000:
        return RESEND_PAID_MONTHLY
    elif emails <= 250_000:
        return RESEND_SCALE_MONTHLY
    else:
        return RESEND_SCALE_MONTHLY + ((emails - 250_000) / 1000) * 0.40

def total_monthly_cost(monthly_active_users, model='sonnet'):
    """Total monthly operating cost"""
    mau = monthly_active_users
    
    # API costs
    if model == 'sonnet':
        per_estimate = cost_per_estimate_sonnet(cached=True)
    else:
        per_estimate = cost_per_estimate_haiku(cached=True)
    
    total_estimates = mau * AVG_ESTIMATES_PER_USER_PER_MONTH
    # Add re-estimates from Anthropic changes
    total_estimates += mau * RE_ESTIMATES_PER_CHANGE * ANTHROPIC_CHANGES_PER_MONTH
    
    api_cost = total_estimates * per_estimate
    
    # Infrastructure
    infra = infra_cost(mau)
    
    # Email
    email = email_cost(mau)
    
    return {
        'monthly_active_users': mau,
        'model': model,
        'estimates_per_month': round(total_estimates),
        'cost_per_estimate': round(per_estimate, 4),
        'api_cost': round(api_cost, 2),
        'infra': infra,
        'email': round(email, 2),
        'total_monthly': round(api_cost + infra['total'] + email, 2),
        'cost_per_user': round((api_cost + infra['total'] + email) / max(mau, 1), 4)
    }

# === GENERATE REPORT ===
print("=" * 80)
print("CLAUDE USAGE ESTIMATOR — OPERATING COST MODEL")
print("=" * 80)
print()

# Show per-estimate costs
print("PER-ESTIMATE API COSTS:")
print(f"  Sonnet 4.6 (cached):    ${cost_per_estimate_sonnet(cached=True):.4f}")
print(f"  Sonnet 4.6 (uncached):  ${cost_per_estimate_sonnet(cached=False):.4f}")
print(f"  Haiku 4.5 (cached):     ${cost_per_estimate_haiku(cached=True):.4f}")
print(f"  Haiku 4.5 (uncached):   ${cost_per_estimate_haiku(cached=False):.4f}")
print()

print("ASSUMPTIONS:")
print(f"  Avg estimates/user/month:  {AVG_ESTIMATES_PER_USER_PER_MONTH}")
print(f"  Re-estimates from changes: {RE_ESTIMATES_PER_CHANGE}/user/change × {ANTHROPIC_CHANGES_PER_MONTH} changes/month")
print(f"  Emails/user/month:         {EMAILS_PER_USER_PER_MONTH}")
print()

# Tiers
tiers = [100, 500, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000]

for model_name in ['sonnet', 'haiku']:
    print(f"\n{'='*80}")
    print(f"MODEL: {'Sonnet 4.6' if model_name == 'sonnet' else 'Haiku 4.5'} (for feature extraction)")
    print(f"{'='*80}")
    print(f"{'MAU':>10} | {'Estimates':>10} | {'API Cost':>10} | {'Infra':>10} | {'Email':>8} | {'TOTAL/mo':>10} | {'$/user':>8}")
    print("-" * 80)
    
    for tier in tiers:
        r = total_monthly_cost(tier, model=model_name)
        print(f"{r['monthly_active_users']:>10,} | {r['estimates_per_month']:>10,} | ${r['api_cost']:>8.2f} | ${r['infra']['total']:>8.2f} | ${r['email']:>6.2f} | ${r['total_monthly']:>8.2f} | ${r['cost_per_user']:>.4f}")

print()
print("=" * 80)
print("COMBINED: Tracker + Estimator (total platform cost)")
print("=" * 80)

# Tracker costs from earlier analysis
tracker_costs = {
    100: 0, 500: 0, 1000: 0, 5000: 45, 10000: 55, 25000: 100, 50000: 175, 100000: 400
}

print(f"{'MAU':>10} | {'Tracker':>10} | {'Estimator':>12} | {'PLATFORM':>12} | {'$/user':>8} | {'Break-even':>20}")
print("-" * 90)

for tier in tiers:
    tracker = tracker_costs.get(tier, 0)
    est = total_monthly_cost(tier, model='sonnet')
    platform = tracker + est['total_monthly']
    per_user = platform / tier
    
    # Break-even: how many paid users at $9/mo needed
    paid_needed = platform / 9 if platform > 0 else 0
    pct_of_users = (paid_needed / tier) * 100 if tier > 0 else 0
    breakeven_str = f"{paid_needed:.0f} paid ({pct_of_users:.1f}%)"
    
    print(f"{tier:>10,} | ${tracker:>8.2f} | ${est['total_monthly']:>10.2f} | ${platform:>10.2f} | ${per_user:>.4f} | {breakeven_str:>20}")

print()
print("Break-even assumes Pro tier at $9/mo. Typical freemium conversion: 5-10%.")
print("At 5% conversion: profitable at ~2,000 MAU. At 10%: profitable at ~500 MAU.")

