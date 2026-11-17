// GhostCoach — Stripe Setup Edge Function
// Called by /card/ page after user enters card details.
// Creates Stripe customer (if needed), attaches payment method, then:
//   builder / operator -> 14-day trialing subscription
//   lifetime           -> one-time $499 charge (no trial, no subscription)
// Returning customer (users.status = 'canceled', had builder/operator):
//   -> new subscription on the plan they choose (Builder default), NO trial, charged
//      immediately. Lifetime stays a one-time charge.
//      If the bank asks for 3-D Secure the function answers requires_action
//      with a client_secret and the page finishes the payment.
// For trials, the customer.subscription.created Stripe
// webhook then fires S5, which flips users.status from 'pending' to 'trialing'.
//
// Required Supabase Edge Function secrets (set via dashboard or CLI):
//   STRIPE_SECRET_KEY, STRIPE_PRICE_BUILDER, STRIPE_PRICE_OPERATOR
//   (optional) STRIPE_LIFETIME_AMOUNT in cents, default 49900
//   SUPABASE_URL (auto-injected), SB_SERVICE_ROLE_KEY

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe           from 'https://esm.sh/stripe@14?target=deno';

const stripe     = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SB_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // Verify authenticated GhostCoach user
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase   = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) return json({ error: 'Unauthorised' }, 401);

    const { payment_method_id, plan: requestedPlan } = await req.json();
    if (!payment_method_id) return json({ error: 'payment_method_id required' }, 400);

    // Load user record
    const { data: userRecord, error: userError } = await supabase
      .from('users')
      .select('email, plan, stripe_customer_id, status')
      .eq('id', user.id)
      .single();

    if (userError || !userRecord) return json({ error: 'User record not found' }, 404);
    // 'pending'  = brand-new customer (gets the free trial).
    // 'canceled' = returning customer restarting a plan (NO free trial).
    // 'incomplete' / 'incomplete_expired' = an earlier restart was started but the bank
    //   step (3-D Secure) was never finished: the customer may simply try again.
    const isReturning = ['canceled', 'incomplete', 'incomplete_expired'].includes(userRecord.status);
    if (userRecord.status !== 'pending' && !isReturning) {
      return json({ error: 'Trial already activated', status: userRecord.status }, 409);
    }

    // Plan: the page may let the visitor switch plan on /payment/, so accept it
    // (whitelisted) and fall back to the plan stored at signup.
    const ALLOWED = ['builder', 'operator', 'lifetime'];
    // A returning customer picks their plan on the page (Builder by default).
    const plan: string = ALLOWED.includes(requestedPlan) ? requestedPlan
                       : isReturning ? 'builder'
                       : ALLOWED.includes(userRecord.plan) ? userRecord.plan
                       : 'builder';
    // For a returning customer the stored plan is only changed after payment succeeds,
    // so a declined card never leaves the account on a plan they did not get.
    if (plan !== userRecord.plan && !isReturning) {
      await supabase.from('users').update({ plan }).eq('id', user.id);
    }

    // Lifetime has 50 founding-member spots. Count paid lifetime users first.
    if (plan === 'lifetime') {
      const { count, error: countError } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('plan', 'lifetime')
        .neq('status', 'pending')
        .neq('id', user.id);
      if (countError) return json({ error: 'Could not check Lifetime availability' }, 500);
      if ((count ?? 0) >= 50) return json({ error: 'All 50 founding-member spots are taken.', code: 'lifetime_sold_out' }, 409);
    }

    // Create Stripe customer if this is the first card entry
    let customerId: string = userRecord.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email:    userRecord.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    // Attach payment method and set as default
    await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: payment_method_id },
    });

    // ── Lifetime: one-time charge, no trial, no subscription ──────────────
    if (plan === 'lifetime') {
      const amount = parseInt(Deno.env.get('STRIPE_LIFETIME_AMOUNT') ?? '49900', 10);
      const intent = await stripe.paymentIntents.create({
        amount,
        currency:       'usd',
        customer:       customerId,
        payment_method: payment_method_id,
        confirm:        true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        description:    'GhostCoach Lifetime (founding member)',
        metadata:       { plan: 'lifetime', supabase_user_id: user.id },
      });
      if (intent.status !== 'succeeded') {
        return json({ error: 'Payment was not completed (' + intent.status + '). Please try another card.' }, 402);
      }
      await supabase.from('users').update({
        plan:   'lifetime',
        status: 'active',
      }).eq('id', user.id);
      return json({ payment_intent_id: intent.id, status: 'succeeded', plan: 'lifetime' });
    }

    // ── Builder / Operator: 14-day trialing subscription ───────────────────
    const priceMap: Record<string, string | undefined> = {
      builder:  Deno.env.get('STRIPE_PRICE_BUILDER'),
      operator: Deno.env.get('STRIPE_PRICE_OPERATOR'),
    };
    const priceId = priceMap[plan];
    if (!priceId) return json({ error: 'No Stripe price configured for this plan' }, 500);

    // ── Returning customer: no trial, first month charged now ─────────────
    if (isReturning) {
      const sub = await stripe.subscriptions.create({
        customer:               customerId,
        items:                  [{ price: priceId }],
        default_payment_method: payment_method_id,
        metadata:               { plan, supabase_user_id: user.id, restart: 'true' },
        payment_settings: {
          payment_method_types:        ['card'],
          save_default_payment_method: 'on_subscription',
        },
        expand: ['latest_invoice.payment_intent'],
      });
      const pi = (sub.latest_invoice as any)?.payment_intent;

      if (sub.status === 'active') {
        await supabase.from('users').update({
          plan,
          status:                 'active',
          stripe_subscription_id: sub.id,
        }).eq('id', user.id);
        return json({ subscription_id: sub.id, status: 'active', restarted: true });
      }

      // Bank wants 3-D Secure: hand the secret to the page, which confirms it.
      // Stripe then sends invoice.payment_succeeded and S5 marks the user active.
      if (sub.status === 'incomplete' && pi && pi.status === 'requires_action') {
        return json({
          requires_action: true,
          client_secret:   pi.client_secret,
          subscription_id: sub.id,
          status:          sub.status,
        });
      }

      // Declined or any other failure: cancel the unpaid subscription so nothing is left hanging.
      try { await stripe.subscriptions.cancel(sub.id); } catch (e) { console.error('stripe-setup cleanup:', e); }
      return json({ error: 'Your card was declined. Please try another card.' }, 402);
    }

    const subscription = await stripe.subscriptions.create({
      customer:             customerId,
      items:                [{ price: priceId }],
      trial_period_days:    14,
      default_payment_method: payment_method_id,
      metadata:             { plan, supabase_user_id: user.id },
      payment_settings: {
        payment_method_types:           ['card'],
        save_default_payment_method:    'on_subscription',
      },
    });

    const trialEnd = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

    await supabase.from('users').update({
      status:                  'trialing',
      trial_start:             new Date().toISOString(),
      trial_end:               trialEnd,
      stripe_subscription_id:  subscription.id,
    }).eq('id', user.id);

    return json({ subscription_id: subscription.id, status: subscription.status });

  } catch (err) {
    console.error('stripe-setup:', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return json({ error: message }, 500);
  }
});