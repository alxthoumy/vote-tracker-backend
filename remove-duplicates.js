const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function removeDuplicates() {
  try {
    console.log('Starting deduplication process...\n');

    // Fetch all voters (handle pagination to get all records)
    let allVoters = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    console.log('Fetching all records from database...');
    while (hasMore) {
      const { data, error } = await supabase
        .from('voters')
        .select('*')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        throw error;
      }

      allVoters = allVoters.concat(data);
      hasMore = data.length === pageSize;
      from += pageSize;
      console.log(`  Fetched ${allVoters.length} records...`);
    }

    console.log(`Total records found: ${allVoters.length}`);

    // Group by full name + father name to find duplicates
    const groupedByName = {};
    allVoters.forEach(voter => {
      const key = `${voter.full_name}_${voter.father_name}`.toLowerCase().trim();
      if (!groupedByName[key]) {
        groupedByName[key] = [];
      }
      groupedByName[key].push(voter);
    });

    // Find duplicates
    const duplicateGroups = Object.entries(groupedByName)
      .filter(([key, voters]) => voters.length > 1);

    console.log(`\nFound ${duplicateGroups.length} groups with duplicates`);

    if (duplicateGroups.length === 0) {
      console.log('No duplicates found. Database is clean!');
      return;
    }

    let totalDuplicates = 0;
    const idsToDelete = [];

    // For each duplicate group, keep the first record and mark others for deletion
    duplicateGroups.forEach(([key, voters]) => {
      console.log(`\nGroup with key "${key}" has ${voters.length} records:`);
      voters.forEach((voter, index) => {
        console.log(`  ${index + 1}. ID: ${voter.id}, Name: ${voter.full_name}, Voted: ${voter.has_voted}`);
      });

      // Keep the first one (oldest by ID), delete the rest
      const toKeep = voters[0];
      const toDelete = voters.slice(1);

      console.log(`  → Keeping ID: ${toKeep.id}`);
      console.log(`  → Deleting ${toDelete.length} duplicate(s): ${toDelete.map(v => v.id).join(', ')}`);

      toDelete.forEach(voter => {
        idsToDelete.push(voter.id);
        totalDuplicates++;
      });
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Total duplicates to remove: ${totalDuplicates}`);
    console.log(`${'='.repeat(60)}\n`);

    // Ask for confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('Do you want to proceed with deletion? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        console.log('\nDeleting duplicates...');

        // Delete in batches of 100 to avoid issues
        for (let i = 0; i < idsToDelete.length; i += 100) {
          const batch = idsToDelete.slice(i, i + 100);
          const { error: deleteError } = await supabase
            .from('voters')
            .delete()
            .in('id', batch);

          if (deleteError) {
            console.error(`Error deleting batch: ${deleteError.message}`);
          } else {
            console.log(`Deleted batch ${Math.floor(i / 100) + 1}: ${batch.length} records`);
          }
        }

        console.log('\n✓ Deduplication complete!');

        // Verify the result
        const { count, error: countError } = await supabase
          .from('voters')
          .select('*', { count: 'exact', head: true });

        if (!countError) {
          console.log(`\nFinal record count: ${count}`);
          console.log(`Records removed: ${allVoters.length - count}`);
        }
      } else {
        console.log('\nOperation cancelled.');
      }

      readline.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error during deduplication:', error.message);
    process.exit(1);
  }
}

removeDuplicates();
