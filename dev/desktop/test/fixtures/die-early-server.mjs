// Fake server: exits before ever sending ready.
setTimeout(() => process.exit(1), 300)
