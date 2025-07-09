# GitHub PR Dashboard

A lightweight, fast dashboard for viewing GitHub pull requests. Built with plain HTML, CSS, and JavaScript for maximum performance and simplicity.

## Features

- **Real GitHub Integration**: Login with GitHub OAuth to view your actual pull requests
- **Smart Categorization**: Automatically groups PRs into Incoming (for review), Outgoing (authored by you), and Drafts
- **Visual Status Indicators**: Color-coded cards and badges show PR status at a glance
- **Activity Sparklines**: See PR activity trends for each section
- **Organization Filtering**: Filter PRs by GitHub organization
- **Demo Mode**: Try the interface with sample data before logging in
- **URL-based User Switching**: View other users' PRs by adding `?user=username` to the URL

## Quick Start

1. Open `index.html` in a web browser
2. Click "Try Demo Mode" to see the interface with sample data, or
3. Login with GitHub to view your real pull requests

## Status Indicators

- 🔴 **Blocked on you**: PRs requiring your immediate attention
- 🟡 **Stale**: PRs older than 30 days
- 🟢 **Ready to merge**: PRs approved and ready for merging
- 🟠 **Merge conflicts**: PRs with conflicts that need resolution
- ⚪ **Draft**: Work-in-progress pull requests

## GitHub OAuth Setup

See [README_OAUTH.md](README_OAUTH.md) for instructions on setting up GitHub OAuth authentication.

## URL Parameters

- `?demo=true` - Launch in demo mode with sample data
- `?user=username` - View a specific GitHub user's pull requests (requires authentication)

## Technical Details

- **Zero Dependencies**: Pure HTML, CSS, and JavaScript (except for demo data)
- **Responsive Design**: Works on desktop and mobile devices
- **Accessible**: ARIA labels and semantic HTML for screen readers
- **Fast**: Minimal JavaScript, efficient DOM updates
- **Clean Code**: Well-organized, commented code following best practices

## File Structure

```
├── index.html           # Main application HTML
├── assets/
│   ├── app.js          # Application JavaScript
│   ├── styles.css      # Application styles
│   └── demo-data.js    # Demo mode sample data
└── README_OAUTH.md     # OAuth setup instructions
```

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome)

## Contributing

This is a simple, focused application. If you'd like to contribute:

1. Keep it simple - no frameworks or build tools
2. Maintain backward compatibility
3. Test on multiple browsers
4. Follow the existing code style

## License

MIT