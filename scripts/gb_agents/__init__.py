"""Gary Budgets agent-workflow package.

Agents:
  CarouselAgent  — Instagram carousel build pipeline (research → write → generate → verify → deploy-ready)
  ReelAgent      — Instagram reel build pipeline (designed frames → render → verify → deploy-ready)
  Verifier       — independent montage-based quality gate (shared)
  Deployer       — git push + vercel + HTTP verification (shared; never approves)

A new platform (TikTok, Shorts) = register it in registry.py + add its agent here.
"""
