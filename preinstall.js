const token = process.env.GH_READ_PACKAGES_TOKEN;

if (!token || token.trim() === "") {
  console.error("\n❌ ERROR: Missing environment variable 'GH_READ_PACKAGES_TOKEN'\n");
  console.error("Please set it before running 'pnpm install'. Example:");
  console.error("  setx GH_READ_PACKAGES_TOKEN \"your_token_here\"\\nn");
  console.error("Or read development.md file .\n");
  process.exit(1);
}
