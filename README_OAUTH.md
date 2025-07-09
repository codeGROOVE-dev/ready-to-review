# GitHub OAuth Setup Instructions

This application uses GitHub OAuth for authentication. Since the OAuth flow requires a backend server to securely exchange the authorization code for an access token, you'll need to set up a simple backend endpoint.

## Option 1: Use Personal Access Token (Development Only)

For development purposes, the app will prompt you to enter a GitHub Personal Access Token instead of completing the full OAuth flow.

1. Go to GitHub Settings > Developer settings > Personal access tokens
2. Generate a new token with `repo` scope
3. When you click "Login with GitHub", enter this token when prompted

## Option 2: Set Up OAuth Backend

### 1. Register GitHub OAuth App

1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Click "New OAuth App"
3. Fill in:
   - Application name: PR Dashboard
   - Homepage URL: http://localhost:8080 (or your domain)
   - Authorization callback URL: http://localhost:8080 (or your domain)
4. Save the Client ID and Client Secret

### 2. Update app.js

Replace `YOUR_GITHUB_CLIENT_ID` in app.js with your actual Client ID.

### 3. Create Backend Endpoint

Create a simple backend server to handle the OAuth token exchange. Here's an example using Node.js:

```javascript
// server.js
const express = require('express');
const axios = require('axios');
const app = express();

const CLIENT_ID = 'YOUR_CLIENT_ID';
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET';

app.use(express.static('.')); // Serve your HTML files

app.get('/oauth/callback', async (req, res) => {
    const { code } = req.query;
    
    try {
        const response = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code
        }, {
            headers: {
                'Accept': 'application/json'
            }
        });
        
        const { access_token } = response.data;
        
        // Return the token to the frontend
        res.send(`
            <script>
                localStorage.setItem('github_token', '${access_token}');
                window.location.href = '/';
            </script>
        `);
    } catch (error) {
        res.status(500).send('OAuth failed');
    }
});

app.listen(8080, () => {
    console.log('Server running on http://localhost:8080');
});
```

### 4. Update OAuth Callback Handling

Modify the `handleOAuthCallback` function in app.js to work with your backend:

```javascript
async function handleOAuthCallback(code) {
    // The backend will handle the token exchange and store it in localStorage
    // Just wait for the redirect
}
```

## URL-Based User Switching

Once logged in, you can view another user's PRs by adding `?user=username` to the URL:

- `http://localhost:8080/?user=octocat` - View octocat's PRs
- `http://localhost:8080/?user=defunkt` - View defunkt's PRs

This allows you to easily switch between different GitHub users without logging out.

## Security Notes

- Never expose your Client Secret in frontend code
- Always use HTTPS in production
- Consider implementing token refresh logic for long-lived sessions
- Add CSRF protection to your OAuth flow