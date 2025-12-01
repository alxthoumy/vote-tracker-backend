const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function importData() {
  try {
    console.log('Starting import of family and classification data...\n');

    // Read Excel file
    const filePath = 'C:\\Users\\User\\Downloads\\5-Roueiss.xlsx';
    console.log('Reading Excel file...');
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref']);

    console.log(`Total rows in Excel: ${range.e.r}\n`);

    // Fetch all voters from database with pagination
    let allVoters = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    console.log('Fetching all voters from database...');
    while (hasMore) {
      const { data, error } = await supabase
        .from('voters')
        .select('id, original_id, full_name, father_name')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      allVoters = allVoters.concat(data);
      hasMore = data.length === pageSize;
      from += pageSize;
      console.log(`  Fetched ${allVoters.length} voters...`);
    }

    console.log(`\nTotal voters in database: ${allVoters.length}`);

    // Create a map of original_id to voter
    const voterMap = new Map();
    allVoters.forEach(voter => {
      voterMap.set(voter.original_id, voter);
    });

    // Process Excel data
    const updates = [];
    let matchedCount = 0;
    let unmatchedCount = 0;

    console.log('\nProcessing Excel data...');
    for (let row = 1; row <= range.e.r; row++) {
      // Get ID from column L (index 11)
      const idCell = worksheet[`L${row + 1}`];
      const originalId = idCell ? idCell.v : null;

      // Get Family from column J (index 9)
      const familyCell = worksheet[`J${row + 1}`];
      const family = familyCell ? familyCell.v : null;

      // Get Classification from column U (index 20)
      const classificationCell = worksheet[`U${row + 1}`];
      const classification = classificationCell ? classificationCell.v : null;

      if (originalId && voterMap.has(originalId)) {
        const voter = voterMap.get(originalId);
        updates.push({
          id: voter.id,
          family: family || null,
          classification: classification || null
        });
        matchedCount++;
      } else if (originalId) {
        unmatchedCount++;
      }

      if ((row + 1) % 500 === 0) {
        console.log(`  Processed ${row + 1}/${range.e.r} rows...`);
      }
    }

    console.log(`\nMatched: ${matchedCount}`);
    console.log(`Unmatched: ${unmatchedCount}`);
    console.log(`Total updates to perform: ${updates.length}\n`);

    // Ask for confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('Do you want to proceed with updating the database? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        console.log('\nUpdating database...');

        let successCount = 0;
        let errorCount = 0;

        // Update in batches of 100
        for (let i = 0; i < updates.length; i += 100) {
          const batch = updates.slice(i, i + 100);

          for (const update of batch) {
            const { error } = await supabase
              .from('voters')
              .update({
                family: update.family,
                classification: update.classification
              })
              .eq('id', update.id);

            if (error) {
              console.error(`  ✗ Error updating ID ${update.id}: ${error.message}`);
              errorCount++;
            } else {
              successCount++;
            }
          }

          console.log(`  Progress: ${Math.min(i + 100, updates.length)}/${updates.length} updated...`);
        }

        console.log(`\n${'='.repeat(60)}`);
        console.log('✓ Import complete!');
        console.log(`Successfully updated: ${successCount}`);
        console.log(`Errors: ${errorCount}`);
        console.log(`${'='.repeat(60)}`);

        // Verify
        console.log('\nVerifying...');
        const { data: sampleData } = await supabase
          .from('voters')
          .select('id, full_name, family, classification')
          .not('family', 'is', null)
          .limit(5);

        console.log('\nSample of updated records:');
        console.log(sampleData);

      } else {
        console.log('\nOperation cancelled.');
      }

      readline.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error during import:', error.message);
    process.exit(1);
  }
}

importData();
