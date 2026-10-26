# Disposable native recovery acceptance

This suite runs only in the expressly authorized GitHub test job. It refuses
normal local invocation and uses a new loopback-only native Supabase stack,
invented `.invalid` identities and no hosted credentials. The official CLI
2.122.0 archive and service lock are checksum-pinned; Auth is 2.197.0. The actual
browser SDK is the same exact version pinned in the Hub and package lock.

The runner creates users only through native Admin Auth. Its bootstrap imports
the released business schema without replacing native Auth roles, helpers,
tables or records. It compares existing UID/email and application grants before
and after recovery. The business dataset is empty; this is not additional proof
of row/projection isolation beyond the existing populated SQL suites.

Native cases cover existing unconfirmed-account recovery-link generation, the
wire contract needed by a private operator helper, one-use redemption and its
individual confirmation consequence, private password change, normal login,
old-password rejection, replay and expiry. No SMTP or mailbox delivery is tested.
The helper's real target configuration is deliberately not included here.

The browser module loads the exact Hub with real native Auth and synthetic
business-read responses. Two accounts/tabs test the password request's identity,
interrupted lifecycle and cleanup. A racing newer tab may be locally signed out
by conservative cleanup; its password must never change. It must also test a
brand-new tab after cleanup, not only a tab sharing the old per-tab marker.

No screenshots, traces, raw process/provider errors, passwords, admin keys,
session tokens or links are retained. The only uploaded artifact is the fixed,
secret-free `result.json`. Cleanup runs after success and failure; a test pass
requires `passed=true` and `cleanup=true` for the exact reviewed head.

This does not authorize production generation, sending an invitation, account
confirmation, password changes, mail configuration, publication or deployment.
It does not prove hosted opaque-key gateway behavior, production Auth settings,
actual mailbox delivery or an employee's physical-phone acceptance.
