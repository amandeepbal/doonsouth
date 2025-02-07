// db.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const CryptoJS = require('crypto-js');
const { v4: uuidv4 } = require('uuid');

const db = new sqlite3.Database(path.join(__dirname, 'database.sqlite'));

// Initialize database tables
db.serialize(() => {
  // Teams table - unchanged
  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_by TEXT NOT NULL,
    contribution_amount DECIMAL(10,2) DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Updated team_members table with profile information
  db.run(`CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT,
    user_id TEXT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    has_paid BOOLEAN DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  )`);

  // Team invitations table - unchanged
  db.run(`CREATE TABLE IF NOT EXISTS team_invitations (
    id TEXT PRIMARY KEY,
    team_id TEXT,
    token TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    FOREIGN KEY (team_id) REFERENCES teams(id)
  )`);

  // Table to store expense details
  db.run(`CREATE TABLE IF NOT EXISTS team_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    expense_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  )`);

  //Junction table to link expenses with team members who were part of the expens
  db.run(`CREATE TABLE IF NOT EXISTS expense_members (
    expense_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    PRIMARY KEY (expense_id, user_id),
    FOREIGN KEY (expense_id) REFERENCES team_expenses(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
)`);

});

// Team management functions
const TeamManager = {
  // Create a new team
  async createTeam(name, userId, userProfile) {
    return new Promise((resolve, reject) => {
      const teamId = uuidv4();
      db.run(
        'INSERT INTO teams (id, name, created_by) VALUES (?, ?, ?)',
        [teamId, name, userId],
        function (err) {
          if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
              reject(new Error('Team name already exists'));
            } else {
              reject(err);
            }
            return;
          }

          // Add creator as team member with profile info
          db.run(
            'INSERT INTO team_members (team_id, user_id, name, email) VALUES (?, ?, ?, ?)',
            [teamId, userId, userProfile.name, userProfile.email],
            (err) => {
              if (err) reject(err);
              else resolve(teamId);
            }
          );
        }
      );
    });
  },

  // Generate invitation link
  async generateInviteLink(teamId, userId) {
    return new Promise(async (resolve, reject) => {
      // Verify user is team creator
      db.get(
        'SELECT created_by FROM teams WHERE id = ?',
        [teamId],
        (err, team) => {
          if (err) {
            reject(err);
            return;
          }

          if (!team || team.created_by !== userId) {
            reject(new Error('Unauthorized'));
            return;
          }

          const inviteId = uuidv4();
          const token = CryptoJS.SHA256(inviteId + Date.now()).toString();
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

          db.run(
            'INSERT INTO team_invitations (id, team_id, token, expires_at) VALUES (?, ?, ?, ?)',
            [inviteId, teamId, token, expiresAt.toISOString()],
            (err) => {
              if (err) reject(err);
              else resolve(token);
            }
          );
        }
      );
    });
  },

  // Join team with invitation
  async joinTeamWithInvite(token, userId, userProfile) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT team_id FROM team_invitations 
         WHERE token = ? AND expires_at > CURRENT_TIMESTAMP`,
        [token],
        (err, invitation) => {
          if (err) {
            reject(err);
            return;
          }

          if (!invitation) {
            reject(new Error('Invalid or expired invitation'));
            return;
          }

          db.run(
            'INSERT OR IGNORE INTO team_members (team_id, user_id, name, email) VALUES (?, ?, ?, ?)',
            [invitation.team_id, userId, userProfile.name, userProfile.email],
            (err) => {
              if (err) reject(err);
              else resolve(invitation.team_id);
            }
          );
        }
      );
    });
  },

  // Get user's teams
  async getUserTeams(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT t.*, 
                (t.created_by = ?) as is_creator,
                COUNT(tm.user_id) as member_count
         FROM teams t
         JOIN team_members tm ON t.id = tm.team_id
         WHERE t.id IN (SELECT team_id FROM team_members WHERE user_id = ?)
         GROUP BY t.id`,
        [userId, userId],
        (err, teams) => {
          if (err) reject(err);
          else resolve(teams);
        }
      );
    });
  },

  // Delete team
  async deleteTeam(teamId, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT created_by FROM teams WHERE id = ?',
        [teamId],
        (err, team) => {
          if (err) {
            reject(err);
            return;
          }

          if (!team || team.created_by !== userId) {
            reject(new Error('Unauthorized'));
            return;
          }

          db.run('BEGIN TRANSACTION');

          // Delete team members
          db.run('DELETE FROM team_members WHERE team_id = ?', [teamId]);

          // Delete team invitations
          db.run('DELETE FROM team_invitations WHERE team_id = ?', [teamId]);

          // Delete team
          db.run('DELETE FROM teams WHERE id = ?', [teamId], (err) => {
            if (err) {
              db.run('ROLLBACK');
              reject(err);
            } else {
              db.run('COMMIT');
              resolve();
            }
          });
        }
      );
    });
  },
  // Leave team
  async leaveTeam(teamId, userId) {
    return new Promise((resolve, reject) => {
      // First check if user is the creator
      db.get(
        'SELECT created_by FROM teams WHERE id = ?',
        [teamId],
        (err, team) => {
          if (err) {
            reject(err);
            return;
          }

          if (team && team.created_by === userId) {
            reject(new Error('Team creator cannot leave. Please delete the team instead.'));
            return;
          }

          // Then check if user is a member
          db.get(
            'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
            [teamId, userId],
            (err, member) => {
              if (err) {
                reject(err);
                return;
              }

              if (!member) {
                reject(new Error('You are not a member of this team'));
                return;
              }

              // If checks pass, remove the member
              db.run(
                'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
                [teamId, userId],
                (err) => {
                  if (err) {
                    reject(err);
                  } else {
                    resolve();
                  }
                }
              );
            }
          );
        }
      );
    });
  },

  async getTeamDetails(teamId) {
    return new Promise((resolve, reject) => {
      // First get the team details
      db.get(
        'SELECT t.*, COUNT(tm.user_id) as total_members FROM teams t LEFT JOIN team_members tm ON t.id = tm.team_id WHERE t.id = ? GROUP BY t.id',
        [teamId],
        (err, team) => {
          if (err) {
            reject(err);
            return;
          }

          if (!team) {
            reject(new Error('Team not found'));
            return;
          }

          // Get contribution details
          db.get(
            `SELECT 
              SUM(CASE WHEN tm.has_paid = 1 THEN 1 ELSE 0 END) as paid_members,
              (t.contribution_amount * COUNT(tm.user_id)) as total_amount,
              (t.contribution_amount * SUM(CASE WHEN tm.has_paid = 1 THEN 1 ELSE 0 END)) as collected_amount
             FROM teams t
             LEFT JOIN team_members tm ON t.id = tm.team_id
             WHERE t.id = ?`,
            [teamId],
            (err, contributionDetails) => {
              if (err) {
                reject(err);
                return;
              }

              // Get all team members with payment status
              db.all(
                `SELECT 
                  user_id, 
                  name, 
                  email, 
                  joined_at,
                  has_paid 
                 FROM team_members 
                 WHERE team_id = ?
                 ORDER BY joined_at ASC`,
                [teamId],
                (err, members) => {
                  if (err) {
                    reject(err);
                    return;
                  }

                  // Process members to ensure valid profile pictures
                  const processedMembers = members.map(member => ({
                    ...member
                  }));

                  // Combine all the data
                  resolve({
                    ...team,
                    members: processedMembers,
                    contribution: {
                      amount: team.contribution_amount || 0,
                      totalAmount: contributionDetails?.total_amount || 0,
                      collectedAmount: contributionDetails?.collected_amount || 0,
                      paidMembers: contributionDetails?.paid_members || 0
                    }
                  });
                }
              );
            }
          );
        }
      );
    });
  },
  // Set contribution amount for team
  async setContributionAmount(teamId, userId, amount) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT created_by FROM teams WHERE id = ?',
        [teamId],
        (err, team) => {
          if (err) {
            reject(err);
            return;
          }

          if (!team || team.created_by !== userId) {
            reject(new Error('Unauthorized: Only team creator can set contribution amount'));
            return;
          }

          db.run(
            'UPDATE teams SET contribution_amount = ? WHERE id = ?',
            [amount, teamId],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        }
      );
    });
  },

  // Update payment status for a team member
  async updatePaymentStatus(teamId, memberId, hasPaid, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT created_by FROM teams WHERE id = ?',
        [teamId],
        (err, team) => {
          if (err) {
            reject(err);
            return;
          }

          if (!team || team.created_by !== userId) {
            reject(new Error('Unauthorized: Only team creator can update payment status'));
            return;
          }

          db.run(
            'UPDATE team_members SET has_paid = ? WHERE team_id = ? AND user_id = ?',
            [hasPaid ? 1 : 0, teamId, memberId],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        }
      );
    });
  },

  // Get team contribution details
  async getTeamContributionDetails(teamId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT t.*, 
                COUNT(tm.user_id) as total_members,
                SUM(CASE WHEN tm.has_paid = 1 THEN 1 ELSE 0 END) as paid_members,
                (t.contribution_amount * COUNT(tm.user_id)) as total_amount,
                (t.contribution_amount * SUM(CASE WHEN tm.has_paid = 1 THEN 1 ELSE 0 END)) as collected_amount
         FROM teams t
         LEFT JOIN team_members tm ON t.id = tm.team_id
         WHERE t.id = ?
         GROUP BY t.id`,
        [teamId],
        (err, details) => {
          if (err) reject(err);
          else resolve(details);
        }
      );
    });
  },

  // Create a new expense
  async createExpense(teamId, description, amount, expenseDate, memberIds) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(
          'INSERT INTO team_expenses (team_id, description, amount, expense_date) VALUES (?, ?, ?, ?)',
          [teamId, description, amount, expenseDate],
          function (err) {
            if (err) {
              db.run('ROLLBACK');
              reject(err);
              return;
            }

            const expenseId = this.lastID;
            const memberValues = memberIds.map(userId =>
              `(${expenseId}, ${userId}, ${teamId})`
            ).join(',');

            db.run(
              `INSERT INTO expense_members (expense_id, user_id, team_id) VALUES ${memberValues}`,
              function (err) {
                if (err) {
                  db.run('ROLLBACK');
                  reject(err);
                  return;
                }

                db.run('COMMIT');
                resolve(expenseId);
              }
            );
          }
        );
      });
    });
  },

  // Update an existing expense
  async updateExpense(expenseId, description, amount, expenseDate, memberIds) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(
          'UPDATE team_expenses SET description = ?, amount = ?, expense_date = ? WHERE id = ?',
          [description, amount, expenseDate, expenseId],
          function (err) {
            if (err) {
              db.run('ROLLBACK');
              reject(err);
              return;
            }

            // Delete existing member associations
            db.run(
              'DELETE FROM expense_members WHERE expense_id = ?',
              [expenseId],
              function (err) {
                if (err) {
                  db.run('ROLLBACK');
                  reject(err);
                  return;
                }

                // Get team_id for the expense
                db.get(
                  'SELECT team_id FROM team_expenses WHERE id = ?',
                  [expenseId],
                  function (err, row) {
                    if (err) {
                      db.run('ROLLBACK');
                      reject(err);
                      return;
                    }

                    // Insert new member associations
                    const memberValues = memberIds.map(userId =>
                      `(${expenseId}, ${userId}, ${row.team_id})`
                    ).join(',');

                    db.run(
                      `INSERT INTO expense_members (expense_id, user_id, team_id) VALUES ${memberValues}`,
                      function (err) {
                        if (err) {
                          db.run('ROLLBACK');
                          reject(err);
                          return;
                        }

                        db.run('COMMIT');
                        resolve();
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    });
  },

  // Delete an expense
  async deleteExpense(expenseId) {
    return new Promise((resolve, reject) => {
      // Due to CASCADE constraints, this will automatically delete related expense_members entries
      db.run(
        'DELETE FROM team_expenses WHERE id = ?',
        [expenseId],
        function (err) {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        }
      );
    });
  },

  // Get a single expense with its members
  async getExpense(expenseId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT te.*, 
                  GROUP_CONCAT(u.id) as member_ids,
                  GROUP_CONCAT(u.name) as member_names
           FROM team_expenses te
           LEFT JOIN expense_members em ON te.id = em.expense_id
           LEFT JOIN users u ON em.user_id = u.id
           WHERE te.id = ?
           GROUP BY te.id`,
        [expenseId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          if (row) {
            row.member_ids = row.member_ids ? row.member_ids.split(',').map(Number) : [];
            row.member_names = row.member_names ? row.member_names.split(',') : [];
          }

          resolve(row);
        }
      );
    });
  },

  // Get all expenses for a team
  async getTeamExpenses(teamId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT te.*, 
                  GROUP_CONCAT(u.id) as member_ids,
                  GROUP_CONCAT(u.name) as member_names
           FROM team_expenses te
           LEFT JOIN expense_members em ON te.id = em.expense_id
           LEFT JOIN users u ON em.user_id = u.id
           WHERE te.team_id = ?
           GROUP BY te.id
           ORDER BY te.expense_date DESC`,
        [teamId],
        (err, rows) => {
          if (err) {
            reject(err);
            return;
          }

          rows = rows.map(row => ({
            ...row,
            member_ids: row.member_ids ? row.member_ids.split(',').map(Number) : [],
            member_names: row.member_names ? row.member_names.split(',') : []
          }));

          resolve(rows);
        }
      );
    });
  },

  // Get team expenses summary (total spent, etc.)
  async getTeamExpensesSummary(teamId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT 
              COUNT(*) as total_expenses,
              SUM(amount) as total_amount,
              MIN(expense_date) as first_expense_date,
              MAX(expense_date) as last_expense_date
           FROM team_expenses
           WHERE team_id = ?`,
        [teamId],
        (err, row) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(row);
        }
      );
    });
  }

};

module.exports = { db, TeamManager };