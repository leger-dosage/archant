# Security policy

Archant holds a household's bank transactions. A flaw in it can expose them, so please report one privately.

## Supported versions

Only the [latest minor release](https://github.com/leger-dosage/archant/releases/latest) receives security fixes. Upgrade to it before reporting, if you can.

| Version              | Supported |
| -------------------- | --------- |
| Latest minor release | yes       |
| Older minor releases | no        |

## Reporting a vulnerability

Report it through GitHub's private vulnerability reporting: [open a draft advisory](https://github.com/leger-dosage/archant/security/advisories/new). Never open a public issue, pull request or discussion about it.

A useful report holds:

- the version shown in « Réglages », the image tag you run, or the commit (`git rev-parse HEAD`) of a checkout;
- the deployment target: the container, a reverse proxy in front of it, or a checkout run with `pnpm`;
- the steps that reproduce the flaw;
- what an attacker gains, and what they need first.

Use made-up amounts, labels and IBANs. Never send real bank data, an access or refresh token, a session cookie, or logs that hold them.

## What happens next

- You get an acknowledgement within 7 days.
- You get a fix, or a plan to mitigate the flaw, within 90 days.
- Once the fix ships in a release, the advisory is published on GitHub and credits you, unless you ask not to be named.

Please keep the flaw private until the advisory is published.
