const { Bot } = require("grammy");
const mongoose = require("mongoose");

require("dotenv").config();

mongoose
  .connect(process.env.GUBOT_MONGO_URI)
  .then(console.log("MongoDB is connected."));

// Define a Mongoose schema and model for expense tracking
const expenseSchema = new mongoose.Schema({
  userId: String,
  username: String,
  amount: Number,
  description: String,
  date: { type: Date, default: Date.now },
});

const Expense = mongoose.model("Expense", expenseSchema);

// Chore Schema
const choreSchema = new mongoose.Schema({
  userId: String,
  username: String,
  chore: String,
  status: {
    type: String,
    enum: ["pending", "completed"],
    default: "pending",
  },
  assignedAt: { type: Date, default: Date.now },
});

const Chore = mongoose.model("Chore", choreSchema);

// Define a Mongoose schema and model for grocery tracking
const grocerySchema = new mongoose.Schema({
  name: String,
  addedBy: String,
  date: { type: Date, default: Date.now },
});

const Grocery = mongoose.model("Grocery", grocerySchema);

// Define a Mongoose schema and model for user preferences
const userSchema = new mongoose.Schema({
  userId: String,
  emoji: String,
  username: String,
});

const User = mongoose.model("User", userSchema);

// Create a bot object
const bot = new Bot(process.env.GUBOT_TOKEN);

// Helper function to extract number and text from message
const parseMessage = (text) => {
  const regex = /(\d+)(.*)/; // Regex to extract the first number and the remaining text
  const match = text.match(regex);
  if (match) {
    const amount = parseFloat(match[1]);
    const description = match[2].trim();
    return { amount, description };
  }
  return null;
};

// Command to set emoji for the user
bot.command("setemoji", async (ctx) => {
  const user = ctx.update.message.from;
  const messageText = ctx.update.message.text;

  // Remove the "/setemoji" part from the message
  const emojiText = messageText.replace("/setemoji", "").trim();

  if (emojiText) {
    // Store the emoji for the user in MongoDB
    try {
      await User.findOneAndUpdate(
        { userId: user.id },
        { emoji: emojiText },
        { upsert: true, new: true }
      );
      await ctx.reply(`✅ Emoji set to "${emojiText}"`);
    } catch (error) {
      console.error("Error setting emoji: ", error);
      await ctx.reply("❌ An error occurred while setting the emoji.");
    }
  } else {
    await ctx.reply("Please enter the emoji in the format: /setemoji <emoji>");
  }
});

// Command to add an item to the grocery list
bot.command("addgrocery", async (ctx) => {
  const user = ctx.update.message.from;
  const messageText = ctx.update.message.text;

  // Remove the "/addgrocery" part from the message
  const groceryText = messageText.replace("/addgrocery", "").trim();

  if (groceryText) {
    // Store the grocery item in MongoDB
    const grocery = new Grocery({
      name: groceryText,
      addedBy: user.username,
    });

    try {
      await grocery.save();
      await ctx.reply(`🛒 Grocery item added: "${groceryText}"`);
    } catch (error) {
      console.error("Error storing grocery item: ", error);
      await ctx.reply("❌ An error occurred while adding the grocery item.");
    }
  } else {
    await ctx.reply(
      "Please enter the grocery item in the format: /addgrocery <item name>"
    );
  }
});

// Command to get the grocery list
bot.command("grocerylist", async (ctx) => {
  try {
    const groceries = await Grocery.find().sort({ date: -1 }); // Fetch all grocery items sorted by date (most recent first)
    const userEmojis = {};
    // Fetch user emojis
    const settings = await User.find();
    settings.forEach((setting) => {
      userEmojis[setting.username] = setting.emoji;
    });

    if (groceries.length === 0) {
      await ctx.reply("No grocery items have been added yet.");
      return;
    }

    let reply = "🛒 Grocery List 🛒\n";
    groceries.forEach((grocery) => {
      const date = new Date(grocery.date).toLocaleDateString();
      const emoji = userEmojis[grocery.addedBy];
      reply += `• ${grocery.name} (added by ${emoji} on ${date})\n`;
    });

    await ctx.reply(reply);
  } catch (error) {
    console.error("Error fetching grocery list: ", error);
    await ctx.reply("❌ An error occurred while fetching the grocery list.");
  }
});

// Modified /addexpense command to remove grocery item if expense matches
bot.command("addexpense", async (ctx) => {
  const user = ctx.update.message.from;
  const messageText = ctx.update.message.text;

  // Remove the "/addexpense" part from the message
  const expenseText = messageText.replace("/addexpense", "").trim();

  // Extract number and description from the remaining message
  const parsed = parseMessage(expenseText);
  if (parsed) {
    const { amount, description } = parsed;

    // Fetch all expenses to calculate balance
    const expenses = await Expense.find();
    const userTotals = {}; // To store the total contribution of each user

    // Calculate each user's total contribution
    expenses.forEach((expense) => {
      if (!userTotals[expense.username]) {
        userTotals[expense.username] = 0;
      }
      userTotals[expense.username] += expense.amount;
    });

    // Calculate the total expenses and share per person
    const totalExpense = Object.values(userTotals).reduce(
      (sum, total) => sum + total,
      0
    );
    const sharePerPerson = totalExpense / 3;

    // Calculate the current user's balance
    const currentUserTotal = userTotals[user.username] || 0;
    const currentUserBalance = currentUserTotal - sharePerPerson;

    // Subtract the added expense from their debt (if any)
    let remainingExpense = amount;
    if (currentUserBalance < 0) {
      const debtReduction = Math.min(
        remainingExpense,
        Math.abs(currentUserBalance)
      );
      remainingExpense -= debtReduction;
    }

    // Store the expense in MongoDB
    const expense = new Expense({
      userId: user.id,
      username: user.username,
      amount,
      description,
    });

    try {
      await expense.save();

      let reply = `✅ Expense recorded: ${amount.toFixed(
        2
      )} for "${description}"\n`;

      if (remainingExpense > 0) {
        reply += `Remaining amount to be split: ${remainingExpense.toFixed(
          2
        )}\n`;
      } else {
        reply += `No remaining amount to split after covering personal debt.\n`;
      }

      // Check if the expense matches an item in the grocery list and remove it
      const groceryItem = await Grocery.findOne({ name: description });
      if (groceryItem) {
        await Grocery.deleteOne({ name: description });
        reply += `🛒 Grocery item "${description}" has been removed from the list.\n`;
      }

      await ctx.reply(reply);
    } catch (error) {
      console.error("Error storing expense: ", error);
      await ctx.reply("❌ An error occurred while saving the expense.");
    }
  } else {
    await ctx.reply(
      "Please enter the expense in the format: /addexpense <amount> <description>"
    );
  }
});

// Command to add a chore
bot.command("addchore", async (ctx) => {
  const user = ctx.update.message.from;
  const messageText = ctx.update.message.text;

  // Remove the "/addchore" part from the message
  const choreText = messageText.replace("/addchore", "").trim();

  if (choreText) {
    // Store the user and chore data in MongoDB
    const chore = new Chore({
      userId: user.id,
      username: user.username,
      chore: choreText,
    });

    try {
      await chore.save();
      await ctx.reply(`✅ Chore recorded: "${choreText}"`);
    } catch (error) {
      console.error("Error storing chore: ", error);
      await ctx.reply("❌ An error occurred while saving the chore.");
    }
  } else {
    await ctx.reply(
      "Please enter the chore in the format: /addchore <chore description>"
    );
  }
});

// Command to get the chore list
bot.command("chorelist", async (ctx) => {
  try {
    const userEmojis = {};
    // Fetch user emojis
    const settings = await User.find();
    settings.forEach((setting) => {
      userEmojis[setting.username] = setting.emoji;
    });

    const chores = await Chore.find({ status: "pending" }).sort({
      assignedAt: -1,
    }); // Fetch only pending chores sorted by date
    if (chores.length > 0) {
      let message = "📝 Chore List:\n";
      chores.forEach((chore, index) => {
        console.log;
        const dateTime = new Date(chore.assignedAt).toLocaleString();
        const emoji = userEmojis[chore.username] || "🤔"; // Default emoji if not set
        message += `${index + 1}. ${
          chore.chore
        } - ${emoji} (Assigned on ${dateTime})\n`;
      });
      await ctx.reply(message);
    } else {
      await ctx.reply("No pending chores available.");
    }
  } catch (error) {
    console.error("Error fetching chores: ", error);
    await ctx.reply("❌ An error occurred while retrieving the chore list.");
  }
});

bot.command("showuser", async (ctx) => {
  try {
    // Fetch all user settings from MongoDB
    const settings = await User.find();

    if (settings.length === 0) {
      await ctx.reply("📋 No user settings found.");
      return;
    }

    let reply = "👥 User Emoji List:\n";

    settings.forEach((setting) => {
      reply += `${setting.emoji} - @${setting.username} - ${setting.userId}\n`; // You can replace `userId` with `username` if you store usernames
    });

    await ctx.reply(reply);
  } catch (error) {
    console.error("Error fetching user settings: ", error);
    await ctx.reply("❌ An error occurred while fetching user settings.");
  }
});

bot.command("balance", async (ctx) => {
  try {
    const expenses = await Expense.find(); // Fetch all expenses from the database
    const userTotals = {}; // To store the total contribution of each user
    const userEmojis = {}; // To store emojis for each user

    // Fetch user emojis
    const settings = await User.find();
    settings.forEach((setting) => {
      userEmojis[setting.userId] = setting.emoji;
    });

    const totalExpense = expenses.reduce((sum, expense) => {
      if (!userTotals[expense.userId]) {
        userTotals[expense.userId] = 0;
      }
      userTotals[expense.userId] += expense.amount;
      return sum + expense.amount;
    }, 0);

    const sharePerPerson = totalExpense / 3; // Divide the total by 3

    let reply = "💰 Expense Balance Summary 💰\n";
    reply += `Total expenses: ${totalExpense.toFixed(2)}\n`;
    reply += `Each person should contribute: ${sharePerPerson.toFixed(2)}\n\n`;

    const balances = [];

    // Calculate how much each person owes or is owed
    for (const [userId, total] of Object.entries(userTotals)) {
      const balance = total - sharePerPerson;
      const emoji = userEmojis[userId] || "🤔"; // Default emoji if not set
      balances.push({ userId, balance, emoji });
      reply += `💼 ${emoji} Paid ${total.toFixed(
        2
      )}, Balance: ${balance.toFixed(2)}\n`;
    }

    reply += "\n🧮 Who owes whom: \n";

    // Determine who owes whom
    const debtors = balances.filter((b) => b.balance < 0);
    const creditors = balances.filter((b) => b.balance > 0);

    // Handle debt repayments
    for (const debtor of debtors) {
      let amountOwed = Math.abs(debtor.balance);
      for (const creditor of creditors) {
        if (amountOwed <= 0) break;
        if (creditor.balance > 0) {
          const repayment = Math.min(amountOwed, creditor.balance);
          reply += `🔗 ${debtor.emoji}  owes ${
            creditor.emoji
          }  ${repayment.toFixed(2)}\n`;
          creditor.balance -= repayment;
          amountOwed -= repayment;
        }
      }
    }

    // If no one owes anything or no creditors/debtors are left
    if (debtors.length === 0 && creditors.length === 0) {
      reply += "Everyone is settled! 🎉";
    }

    await ctx.reply(reply);
  } catch (error) {
    console.error("Error calculating balance: ", error);
    await ctx.reply("❌ An error occurred while calculating the balance.");
  }
});

// Helper function to calculate days until the 27th of the month
const calculateDaysUntilRent = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  const rentDate = new Date(year, month, 27); // 27th of this month

  if (today > rentDate) {
    // If today is past the 27th, calculate the days till the next month's 27th
    const nextRentDate = new Date(year, month + 1, 27);
    const diffTime = nextRentDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  } else {
    // If today is before the 27th, calculate the days till this month's 27th
    const diffTime = rentDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }
};

// Command to mark a chore as completed
bot.command("completechore", async (ctx) => {
  const messageText = ctx.update.message.text;
  const user = ctx.update.message.from;

  // Remove the "/completechore" part from the message and trim the text
  const completeText = messageText.replace("/completechore", "").trim();

  // Expected format: /completechore chore description
  if (!completeText) {
    return ctx.reply("Please specify the chore description to complete.");
  }

  try {
    // Find the chore by description and mark it as completed
    const updatedChore = await Chore.findOneAndUpdate(
      { chore: completeText, username: user.username }, // Find the chore assigned to this user
      { status: "completed" }, // Set the status to "completed"
      { new: true } // Return the updated chore
    );

    if (updatedChore) {
      await ctx.reply(`✅ Chore marked as completed: "${completeText}"`);
    } else {
      await ctx.reply(
        `❌ Could not find a pending chore with the description: "${completeText}"`
      );
    }
  } catch (error) {
    console.error("Error marking chore as completed: ", error);
    await ctx.reply("❌ An error occurred while updating the chore status.");
  }
});

// Command to assign a chore to a specific user
bot.command("assignchore", async (ctx) => {
  const messageText = ctx.update.message.text;
  const user = ctx.update.message.from;

  // Remove the "/assignchore" part from the message and trim the text
  const assignText = messageText.replace("/assignchore", "").trim();

  // Expected format: /assignchore @username chore description
  const regex = /@(\w+)\s(.+)/;
  const match = assignText.match(regex);

  if (match) {
    const assignedToUsername = match[1];
    const choreDescription = match[2].trim();

    // Store the assigned chore in MongoDB with a default status of "pending"
    const assignedChore = new Chore({
      userId: null, // Since the user is being assigned, we don't know their userId yet
      username: assignedToUsername,
      chore: choreDescription,
      status: "pending", // Default status is pending
    });

    try {
      await assignedChore.save();
      await ctx.reply(
        `✅ Chore assigned to @${assignedToUsername}: "${choreDescription}"`
      );
    } catch (error) {
      console.error("Error assigning chore: ", error);
      await ctx.reply("❌ An error occurred while assigning the chore.");
    }
  } else {
    await ctx.reply(
      "Please enter the chore assignment in the format: /assignchore @username <chore description>"
    );
  }
});

// Command to check days until rent
bot.command("rentdays", async (ctx) => {
  const daysLeft = calculateDaysUntilRent();
  await ctx.reply(`There are ${daysLeft} days left until the 27th.`);
});

// Start the bot (using long polling)
bot.start();
