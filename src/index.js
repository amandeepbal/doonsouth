const express = require('express');
const session = require('express-session');
const { createClient } = require('@supabase/supabase-js');
const { TeamManager } = require('./db');

require('dotenv').config();

const app = express();

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // set to true if using HTTPS
}));

// Set view engine
app.set('view engine', 'ejs');

// Routes
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.get('/register', (req, res) => {
    res.render('register');
});

// Auth routes
app.post('/auth/register', async (req, res) => {
    const { email, password, name } = req.body;
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password
            ,
            options: {
                data: {
                    name: name
                }
            }
        });

        if (error) throw error;

        req.session.user = data.user;
        res.redirect('/');
    } catch (error) {
        res.render('register', { error: error.message });
    }
});

app.post('/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        req.session.user = data.user;
        res.redirect('/');
    } catch (error) {
        res.render('login', { error: error.message });
    }
});

app.get('/auth/logout', async (req, res) => {
    await supabase.auth.signOut();
    req.session.destroy();
    res.redirect('/');
});


// Team routes
// Update these existing routes to include user profile info
app.post('/api/teams', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const teamId = await TeamManager.createTeam(
            req.body.name,
            req.session.user.id,
            {
                name: req.session.user.user_metadata.name,
                email: req.session.user.email
            }
        );
        res.json({ id: teamId });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});


app.get('/api/teams', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const teams = await TeamManager.getUserTeams(req.session.user.id);
        res.json(teams);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/api/teams/:teamId/invite', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const token = await TeamManager.generateInviteLink(
            req.params.teamId,
            req.session.user.id
        );
        const inviteLink = `${process.env.APP_URL || 'http://localhost:3000'}/join-team/${token}`;
        res.json({ inviteLink });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/join-team/:token', async (req, res) => {
    if (!req.session.user) {
        req.session.pendingInvite = req.params.token;
        return res.redirect('/');
    }

    try {
        await TeamManager.joinTeamWithInvite(
            req.params.token,
            req.session.user.id,
            {
                name: req.session.user.user_metadata.name,
                email: req.session.user.email
            }
        );
        res.redirect('/?message=team_joined');
    } catch (error) {
        res.redirect(`/?error=${encodeURIComponent(error.message)}`);
    }
});

app.delete('/api/teams/:teamId', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        await TeamManager.deleteTeam(req.params.teamId, req.session.user.id);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Add this new endpoint for leaving a team
app.post('/api/teams/:teamId/leave', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        await TeamManager.leaveTeam(req.params.teamId, req.session.user.id);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Set contribution amount for team
app.post('/api/teams/:teamId/contribution', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { amount } = req.body;
    if (!amount || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ error: 'Invalid contribution amount' });
    }

    try {
        await TeamManager.setContributionAmount(
            req.params.teamId,
            req.session.user.id,
            parseFloat(amount)
        );
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update member payment status
app.post('/api/teams/:teamId/members/:memberId/payment', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { hasPaid } = req.body;
    try {
        await TeamManager.updatePaymentStatus(
            req.params.teamId,
            req.params.memberId,
            hasPaid,
            req.session.user.id
        );
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get team contribution details
app.get('/api/teams/:teamId/contribution', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const details = await TeamManager.getTeamContributionDetails(req.params.teamId);
        res.json(details);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});
// Add this route to your app.js
app.get('/api/teams/:teamId/members', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const teamDetails = await TeamManager.getTeamDetails(req.params.teamId);
        res.json(teamDetails);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Expense routes - Add these to your existing Express app

// Create a new expense
app.post('/api/teams/:teamId/expenses', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { description, amount, expenseDate, memberIds } = req.body;

    if (!description || !amount || !expenseDate || !memberIds || !Array.isArray(memberIds)) {
        return res.status(400).json({ error: 'Missing or invalid required fields' });
    }

    try {
        const expenseId = await TeamManager.createExpense(
            req.params.teamId,
            description,
            parseFloat(amount),
            new Date(expenseDate),
            memberIds
        );
        res.json({ id: expenseId });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get all expenses for a team
app.get('/api/teams/:teamId/expenses', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const expenses = await TeamManager.getTeamExpenses(req.params.teamId);
        res.json(expenses);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get a specific expense
app.get('/api/teams/:teamId/expenses/:expenseId', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const expense = await TeamManager.getExpense(req.params.expenseId);
        if (!expense || expense.team_id !== req.params.teamId) {
            return res.status(404).json({ error: 'Expense not found' });
        }
        res.json(expense);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Update an expense
app.put('/api/teams/:teamId/expenses/:expenseId', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { description, amount, expenseDate, memberIds } = req.body;

    if (!description || !amount || !expenseDate || !memberIds || !Array.isArray(memberIds)) {
        return res.status(400).json({ error: 'Missing or invalid required fields' });
    }

    try {
        await TeamManager.updateExpense(
            req.params.expenseId,
            description,
            parseFloat(amount),
            new Date(expenseDate),
            memberIds
        );
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Delete an expense
app.delete('/api/teams/:teamId/expenses/:expenseId', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        await TeamManager.deleteExpense(req.params.expenseId);
        res.json({ success: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Get expense summary for a team
app.get('/api/teams/:teamId/expenses/summary', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const summary = await TeamManager.getTeamExpensesSummary(req.params.teamId);
        res.json(summary);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});