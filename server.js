const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Initialize Google Sheets API
let sheets;
let auth;

async function initGoogleSheets() {
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      sheets = google.sheets({ version: 'v4', auth });
      console.log('Google Sheets API initialized');
    } else {
      console.log('Google Sheets not configured - skipping');
    }
  } catch (error) {
    console.error('Error initializing Google Sheets:', error.message);
  }
}

initGoogleSheets();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all voters with filtering, searching, and pagination
app.get('/api/voters', async (req, res) => {
  try {
    const { 
      search, 
      religion, 
      voted,
      register_number,
      page = 1, 
      limit = 50 
    } = req.query;
    
    let query = supabase
      .from('voters')
      .select('*', { count: 'exact' });
    
    // Search by register number (exact or partial)
    if (register_number) {
      query = query.or(`register_number.ilike.%${register_number}%,register_number_clean.ilike.%${register_number}%`);
    }
    
    // Search by name (partial match)
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,family_name.ilike.%${search}%,father_name.ilike.%${search}%`);
    }
    
    // Filter by religion
    if (religion && religion !== 'all') {
      query = query.eq('religion', religion);
    }
    
    // Filter by voted status
    if (voted === 'true') {
      query = query.eq('has_voted', true);
    } else if (voted === 'false') {
      query = query.eq('has_voted', false);
    }
    
    // Pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);
    
    // Order by ID
    query = query.order('original_id', { ascending: true });
    
    const { data, error, count } = await query;
    
    if (error) throw error;
    
    res.json({
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count,
        totalPages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching voters:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get voter by ID
app.get('/api/voters/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('voters')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    if (!data) {
      return res.status(404).json({ success: false, error: 'Voter not found' });
    }
    
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching voter:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Mark voter as voted
app.post('/api/voters/:id/vote', async (req, res) => {
  try {
    const { id } = req.params;
    const votedAt = new Date().toISOString();
    
    // Update in Supabase
    const { data, error } = await supabase
      .from('voters')
      .update({ 
        has_voted: true, 
        voted_at: votedAt 
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    // Update Google Sheets if configured
    if (sheets && process.env.GOOGLE_SHEET_ID) {
      try {
        await updateGoogleSheet(data);
      } catch (sheetsError) {
        console.error('Error updating Google Sheets:', sheetsError.message);
        // Don't fail the request if Sheets update fails
      }
    }
    
    res.json({ 
      success: true, 
      data,
      message: 'Vote recorded successfully'
    });
  } catch (error) {
    console.error('Error recording vote:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Unmark voter (undo vote)
app.post('/api/voters/:id/unvote', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('voters')
      .update({ 
        has_voted: false, 
        voted_at: null 
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    // Update Google Sheets if configured
    if (sheets && process.env.GOOGLE_SHEET_ID) {
      try {
        await updateGoogleSheetUnvote(data);
      } catch (sheetsError) {
        console.error('Error updating Google Sheets:', sheetsError.message);
      }
    }
    
    res.json({ 
      success: true, 
      data,
      message: 'Vote removed successfully'
    });
  } catch (error) {
    console.error('Error removing vote:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get statistics
app.get('/api/stats', async (req, res) => {
  try {
    // Get total voters
    const { count: total } = await supabase
      .from('voters')
      .select('*', { count: 'exact', head: true });
    
    // Get voted count
    const { count: voted } = await supabase
      .from('voters')
      .select('*', { count: 'exact', head: true })
      .eq('has_voted', true);
    
    // Get votes by religion
    const { data: religionStats } = await supabase
      .from('voters')
      .select('religion, has_voted');
    
    const byReligion = {};
    religionStats?.forEach(voter => {
      const rel = voter.religion || 'غير محدد';
      if (!byReligion[rel]) {
        byReligion[rel] = { total: 0, voted: 0 };
      }
      byReligion[rel].total++;
      if (voter.has_voted) {
        byReligion[rel].voted++;
      }
    });
    
    res.json({
      success: true,
      data: {
        total,
        voted,
        notVoted: total - voted,
        percentage: total > 0 ? ((voted / total) * 100).toFixed(2) : 0,
        byReligion
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all unique religions for filter dropdown
app.get('/api/religions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('voters')
      .select('religion')
      .not('religion', 'is', null);
    
    if (error) throw error;
    
    const religions = [...new Set(data.map(v => v.religion))].filter(r => r && r !== '--').sort();
    
    res.json({ success: true, data: religions });
  } catch (error) {
    console.error('Error fetching religions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Google Sheets update function
async function updateGoogleSheet(voter) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
  
  // Find the row with matching ID and update the "Voted" column
  // First, get all data to find the row
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${sheetName}!A:L` // Assuming ID is in column L
  });
  
  const rows = response.data.values || [];
  let rowIndex = -1;
  
  // Find the row with matching original_id (column L, index 11)
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][11] && parseInt(rows[i][11]) === voter.original_id) {
      rowIndex = i + 1; // 1-indexed for Sheets
      break;
    }
  }
  
  if (rowIndex === -1) {
    console.log(`Voter ID ${voter.original_id} not found in sheet`);
    return;
  }
  
  // Update column B (اقترع) with "Yes"
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetName}!B${rowIndex}`,
    valueInputOption: 'RAW',
    resource: {
      values: [['Yes']]
    }
  });
  
  console.log(`Updated Google Sheet row ${rowIndex} for voter ${voter.original_id}`);
}

async function updateGoogleSheetUnvote(voter) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
  
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${sheetName}!A:L`
  });
  
  const rows = response.data.values || [];
  let rowIndex = -1;
  
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][11] && parseInt(rows[i][11]) === voter.original_id) {
      rowIndex = i + 1;
      break;
    }
  }
  
  if (rowIndex === -1) return;
  
  // Clear the vote (set to empty)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${sheetName}!B${rowIndex}`,
    valueInputOption: 'RAW',
    resource: {
      values: [['']]
    }
  });
  
  console.log(`Cleared vote in Google Sheet row ${rowIndex} for voter ${voter.original_id}`);
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
