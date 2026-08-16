# Episode 1 Manuscript

## Why I Used Negative Binomial Regression for Mosquito Eggs

**Target length:** approximately 8 minutes  
**Language:** English  

Text in square brackets is a production cue and should not be read aloud.

---

## 0:00–0:20 — Opening

**[Title slide]**

Hi, everyone. In this video, I will explain how we can choose a Negative Binomial generalized linear model for discrete, overdispersed counts in environmental studies.

I will use mosquito egg counts as an example and stick around if you'd like a practical modeling tip without heavy math.

## 0:20–0:50 — The monitoring network

**[Interactive monitoring-network slide]**

I have mosquito egg counts collected from 34 ovitraps in San Pedro de Jujuy, Argentina.

An ovitrap is a small container that attracts females ready to lay eggs. Each week, our field team checks working traps and counts the eggs.

Both the egg total and the number of valid traps can vary from week to week.

## 0:50–1:10 — Quiet, then explode

**[Show the quiet week.]**

Here’s a relatively quiet week: just fifteen eggs were collected across the functioning traps.

**[Click to reveal the peak week.]**

But during the peak week, the same network collected more than seven thousand eggs.

The study area did not change, but the egg counts changed dramatically over time.

## 1:10–1:35 — Predictors and response

**[Temperature → expected mosquito egg count]**

My main question is whether environmental conditions can help explain how these counts change over time.

I’ll start with one predictor—air temperature—and model the expected weekly egg count.

Later, we could add vapor pressure and other variables. But starting simple makes the logic easier to see.

## 1:35–2:05 — Inspect the response

**[Histogram and egg-versus-temperature plot]**

Before choosing a model, we should inspect the response and its relationship with the predictor.

The histogram is bounded at zero and strongly right-skewed: there are many low-count weeks and a few extremely high ones.

The temperature plot also suggests a nonlinear pattern, with much greater spread at warmer temperatures.

These plots don’t prove which model is correct, but they suggest that ordinary Gaussian assumptions are not a natural starting point.

## 2:05–2:30 — Why not ordinary linear regression?

**[Ordinary linear-regression slide]**

So why not use ordinary linear regression?

A straight-line Gaussian model can predict negative expected egg counts, which makes no biological sense. The changing spread also suggests that the assumption of constant variance may not hold. We would confirm that with residual diagnostics, but count regression is already a more natural starting point.

## 2:30–2:55 — From a linear model to a GLM

**[Animate: Linear Model → Generalized Linear Model → GLM.]**

This brings us from ordinary linear regression to a generalized linear model, or GLM.

I think of a GLM as familiar regression using different tools. 

We still use predictors to explain an expected response, but we adapt the model to the kind of data we have.

**[Reveal the four items in the toolbox.]**

For this example, I need four connected choices: a distribution, a linear predictor, a link function, and an offset for sampling effort.

## 2:55–3:25 — Poisson as the starting point

**[Poisson benchmark slide]**

Because my outcome is a non-negative count with no fixed upper limit, Poisson regression is the classic starting point.

In the notation on screen, Y-sub-i is the observed egg count in week i. X-sub-i represents the predictor values for that week—temperature in this simple example. And mu-sub-i is the expected egg count for that week, given those predictor values.

Poisson is a sensible place to begin, but it makes one important assumption.

## 3:25–4:05 — Poisson and overdispersion

**[Conditional mean–variance slide]**

After accounting for the predictors, a Poisson model assumes that the conditional variance equals the conditional mean.

‘Conditional’ matters because temperature may already explain some differences between weeks.

The assumption concerns the variation that remains when we compare weeks with the same predictors — here, weeks at the same temperature.

Imagine two groups of weeks, both with an expected count of one hundred. 

In one group, counts stay close to one hundred; in the other, they range from almost zero to several hundred. 

Poisson has limited room for the second pattern.

**[Jump back to the response plots, then return.]**

After accounting for temperature and sampling effort, we found much more variability than Poisson could accommodate.

That’s conditional overdispersion, and it supports using negative binomial regression. 

Apparently, mosquitoes prefer a high-variance world.

## 4:05–4:35 — Negative Binomial regression

**[Poisson-versus-Negative-Binomial slide]**

This is where Negative Binomial regression becomes useful.

It still models nonnegative counts, but it adds a dispersion parameter, alpha, which gives the conditional variance room to grow beyond the mean.

I think of it as a count model that allows extra real-world variability.

And don’t let the word ‘negative’ scare you—it’s just the distribution’s name. 

The model still produces zero or positive egg counts, never negative ones.

## 4:35–5:10 — Why use a log link?

**[Log-link slide]**

Choosing the negative binomial distribution describes how observations vary around the expected count. 

We still need to connect temperature to that expected count, and for that we use a log link.

The model is linear on the log-mean scale: log of mu.

Transforming back guarantees the expected count stays positive. 

It also explains why a linear predictor can create a curved relationship on the original count scale.

**[Jump back to the temperature plot, then return.]**

Importantly, we are not taking the logarithm of the observed egg counts, so zeroes are allowed. The link is on the expected count, mu.

## 5:10–5:45 — Multiplicative effects

**[Coefficient → exponentiate → rate ratio]**

The log link makes predictor effects multiplicative rather than additive.

In my temperature-only model, the estimated coefficient was zero point two four seven five.

Exponentiating it gives about one point two eight one, so a one-degree Celsius increase is associated with about a twenty-eight percent higher expected egg rate.

## 5:45–6:25 — Why sampling effort matters

**[Week A versus Week B]**

Now consider two weeks.

In week one, ten valid traps collect five hundred eggs—fifty eggs per functioning trap.

In week two, twenty valid traps collect eight hundred eggs.

The raw total is larger, but the rate is only forty eggs per trap. 

Looking only at totals would give the wrong impression, because sampling effort changed.

**[Jump back to the monitoring network, then return.]**

The number of functioning ovitraps is not identical every week. 

More functioning traps create more opportunities to collect eggs, so the model should not confuse greater sampling opportunity with a real biological change in mosquito activity.

## 6:25–7:05 — The offset

**[Offset slide]**

That is why I use the logarithm of valid traps as an offset.

Its coefficient is fixed at one, meaning the model does not estimate the trap-number effect as it estimates temperature.

Instead, we tell the model that valid traps represent proportional sampling exposure.

After transforming back from the log scale, the expected egg total equals the number of valid traps times the expected rate per trap.

At the same temperature, twice as many functioning traps means twice the expected eggs collected.

This assumes functioning traps provide roughly comparable sampling exposure.

## 7:05–7:30 — The complete model

**[Reveal the four decisions and then the equations.]**

Now the full logic fits together.

Temperature is the predictor. 

The negative binomial distribution handles the overdispersed egg counts.

The log link connects temperature to a positive expected count.

And the number of valid traps enters as an offset to account for unequal sampling effort.

That is the basic logic behind this model.

## 7:30–7:55 — What the first model shows

**[Temperature curve and temporal observed-versus-predicted plot]**

These two plots show the same temperature-only model in different ways.

On the left, the curve shows the expected egg rate across temperatures. 

On the right, the observed values and predictions are ordered by temperature.

Temperature captures part of the pattern, but not every peak.

The fitted curve represents the conditional mean, while the negative binomial distribution allows individual observations to vary around it.

The remaining mismatches suggest that temperature alone is not the complete ecological story.

## 7:55–8:20 — Closing

**[Temperature + vapor pressure + NDVI slide]**

The next step is to ask whether vapor pressure, your next predictor, or another biologically meaningful variable improves explanation.

The negative binomial model handled overdispersion much better than Poisson, but residual temporal autocorrelation did not disappear entirely. 

In other words, neighboring weeks still contain related information this simple model doesn’t capture.

In the next episode, I’ll explore additional predictors and that remaining temporal structure.

I’m not a statistician. I’m an applied environmental researcher who took the time to understand why I was using this model. 

Making this video is part of that learning process: I use this model, I want to understand it properly, and now I’m sharing what I learned.
