const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function fixRegisterNumbers() {
  try {
    console.log('Fixing duplicate register numbers...\n');

    // Fetch all voters
    const { data: allVoters, error } = await supabase
      .from('voters')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      throw error;
    }

    console.log(`Total records: ${allVoters.length}\n`);

    // Group by register number
    const byRegisterNumber = {};
    allVoters.forEach(voter => {
      const key = voter.register_number;
      if (key) {
        if (!byRegisterNumber[key]) {
          byRegisterNumber[key] = [];
        }
        byRegisterNumber[key].push(voter);
      }
    });

    const duplicateGroups = Object.entries(byRegisterNumber)
      .filter(([key, voters]) => voters.length > 1);

    console.log(`Found ${duplicateGroups.length} register numbers with multiple voters\n`);

    if (duplicateGroups.length === 0) {
      console.log('No duplicates found!');
      return;
    }

    const updates = [];

    // For each group, keep the first one unchanged and update the rest
    duplicateGroups.forEach(([regNum, voters]) => {
      console.log(`Register "${regNum}" has ${voters.length} voters:`);

      voters.forEach((voter, index) => {
        if (index === 0) {
          console.log(`  ${index + 1}. ID ${voter.id}: "${voter.full_name}" - KEEPING as ${regNum}`);
        } else {
          // Create unique register number by appending suffix
          const newRegNum = `${regNum}-${index}`;
          console.log(`  ${index + 1}. ID ${voter.id}: "${voter.full_name}" - UPDATING to ${newRegNum}`);

          updates.push({
            id: voter.id,
            oldRegNum: regNum,
            newRegNum: newRegNum
          });
        }
      });
      console.log('');
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Total updates needed: ${updates.length}`);
    console.log(`${'='.repeat(60)}\n`);

    // Ask for confirmation
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    readline.question('Do you want to proceed with updating register numbers? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
        console.log('\nUpdating register numbers...');

        let successCount = 0;
        let errorCount = 0;

        // Update one by one
        for (const update of updates) {
          const { error: updateError } = await supabase
            .from('voters')
            .update({ register_number: update.newRegNum })
            .eq('id', update.id);

          if (updateError) {
            console.error(`✗ Error updating ID ${update.id}: ${updateError.message}`);
            errorCount++;
          } else {
            successCount++;
            if (successCount % 50 === 0) {
              console.log(`  Progress: ${successCount}/${updates.length} updated...`);
            }
          }
        }

        console.log(`\n${'='.repeat(60)}`);
        console.log('✓ Update complete!');
        console.log(`Successfully updated: ${successCount}`);
        console.log(`Errors: ${errorCount}`);
        console.log(`${'='.repeat(60)}`);

        // Verify
        console.log('\nVerifying...');
        const { data: afterUpdate } = await supabase
          .from('voters')
          .select('register_number');

        const regNums = afterUpdate.map(v => v.register_number);
        const uniqueRegNums = new Set(regNums);

        console.log(`Total records: ${regNums.length}`);
        console.log(`Unique register numbers: ${uniqueRegNums.size}`);

        if (regNums.length === uniqueRegNums.size) {
          console.log('✓ All register numbers are now unique!');
        } else {
          console.log(`⚠ Still ${regNums.length - uniqueRegNums.size} duplicates remaining`);
        }

      } else {
        console.log('\nOperation cancelled.');
      }

      readline.close();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error fixing register numbers:', error.message);
    process.exit(1);
  }
}

fixRegisterNumbers();
