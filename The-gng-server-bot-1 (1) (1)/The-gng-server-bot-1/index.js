const mineflayer = require('mineflayer');
const Movements = require('mineflayer-pathfinder').Movements;
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const { GoalBlock } = require('mineflayer-pathfinder').goals;

const config = require('./settings.json');
const express = require('express');

process.on('uncaughtException', (err) => {
   console.log(`\x1b[31m[CRASH PREVENTED] ${err.message}\x1b[0m`);
});

process.on('unhandledRejection', (err) => {
   console.log(`\x1b[31m[CRASH PREVENTED] ${err}\x1b[0m`);
});

const app = express();

app.get('/', (req, res) => {
  res.send('Bot has arrived');
});

app.listen(8000, () => {
  console.log('Server started');
});

function createBot() {
   const bot = mineflayer.createBot({
      username: config['bot-account']['username'],
      password: config['bot-account']['password'],
      auth: config['bot-account']['type'],
      host: config.server.ip,
      port: config.server.port,
      version: config.server.version,
   });

   bot.loadPlugin(pathfinder);
   const mcData = require('minecraft-data')(bot.version);
   const defaultMove = new Movements(bot, mcData);
   bot.settings.colorsEnabled = false;

   let pendingPromise = Promise.resolve();

   function sendRegister(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/register ${password} ${password}`);
         console.log(`[Auth] Sent /register command.`);

         bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`); // Log all chat messages

            // Check for various possible responses
            if (message.includes('successfully registered')) {
               console.log('[INFO] Registration confirmed.');
               resolve();
            } else if (message.includes('already registered')) {
               console.log('[INFO] Bot was already registered.');
               resolve(); // Resolve if already registered
            } else if (message.includes('Invalid command')) {
               reject(`Registration failed: Invalid command. Message: "${message}"`);
            } else {
               reject(`Registration failed: unexpected message "${message}".`);
            }
         });
      });
   }

   function sendLogin(password) {
      return new Promise((resolve, reject) => {
         bot.chat(`/login ${password}`);
         console.log(`[Auth] Sent /login command.`);

         bot.once('chat', (username, message) => {
            console.log(`[ChatLog] <${username}> ${message}`); // Log all chat messages

            if (message.includes('successfully logged in')) {
               console.log('[INFO] Login successful.');
               resolve();
            } else if (message.includes('Invalid password')) {
               reject(`Login failed: Invalid password. Message: "${message}"`);
            } else if (message.includes('not registered')) {
               reject(`Login failed: Not registered. Message: "${message}"`);
            } else {
               reject(`Login failed: unexpected message "${message}".`);
            }
         });
      });
   }

   bot.once('spawn', () => {
      console.log('\x1b[33m[AfkBot] Bot joined the server', '\x1b[0m');

      if (config.utils['auto-auth'].enabled) {
         console.log('[INFO] Started auto-auth module');

         const password = config.utils['auto-auth'].password;

         pendingPromise = pendingPromise
            .then(() => sendRegister(password))
            .then(() => sendLogin(password))
            .catch(error => console.error('[ERROR]', error));
      }

      if (config.utils['chat-messages'].enabled) {
         console.log('[INFO] Started chat-messages module');
         const messages = config.utils['chat-messages']['messages'];

         if (config.utils['chat-messages'].repeat) {
            const delay = config.utils['chat-messages']['repeat-delay'];
            let i = 0;

            let msg_timer = setInterval(() => {
               bot.chat(`${messages[i]}`);

               if (i + 1 === messages.length) {
                  i = 0;
               } else {
                  i++;
               }
            }, delay * 1000);
         } else {
            messages.forEach((msg) => {
               bot.chat(msg);
            });
         }
      }

      const pos = config.position;

      if (config.position.enabled) {
         console.log(
            `\x1b[32m[Afk Bot] Starting to move to target location (${pos.x}, ${pos.y}, ${pos.z})\x1b[0m`
         );
         bot.pathfinder.setMovements(defaultMove);
         bot.pathfinder.setGoal(new GoalBlock(pos.x, pos.y, pos.z));
      }

   });

   let antiAfkInterval = null;
   let walkInterval = null;
   let actionIndex = 0;
   
   function doAntiAfk() {
      const actions = [
         () => {
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 500);
         },
         () => {
            bot.swingArm('right');
         },
         () => {
            const yaw = Math.random() * Math.PI * 2;
            const pitch = (Math.random() - 0.5) * Math.PI;
            bot.look(yaw, pitch, false);
         },
         () => {
            bot.setControlState('forward', true);
            setTimeout(() => {
               bot.setControlState('forward', false);
               bot.setControlState('back', true);
               setTimeout(() => bot.setControlState('back', false), 300);
            }, 300);
         },
         () => {
            bot.setControlState('left', true);
            setTimeout(() => {
               bot.setControlState('left', false);
               bot.setControlState('right', true);
               setTimeout(() => bot.setControlState('right', false), 200);
            }, 200);
         },
         () => {
            bot.setControlState('jump', true);
            bot.setControlState('forward', true);
            setTimeout(() => {
               bot.setControlState('jump', false);
               bot.setControlState('forward', false);
            }, 400);
         }
      ];
      
      actions[actionIndex]();
      actionIndex = (actionIndex + 1) % actions.length;
      
      if (config.utils['anti-afk'].sneak) {
         bot.setControlState('sneak', true);
      }
   }
   
   bot.on('spawn', () => {
      if (config.utils['anti-afk'].enabled) {
         if (antiAfkInterval) clearInterval(antiAfkInterval);
         if (walkInterval) clearInterval(walkInterval);
         
         antiAfkInterval = setInterval(doAntiAfk, 2000);
         
         walkInterval = setInterval(() => {
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 100);
         }, 500);
         
         console.log('[INFO] Anti-AFK enabled (rotating actions: swing, look, walk)');
      }
   });
   
   bot.on('end', () => {
      if (antiAfkInterval) {
         clearInterval(antiAfkInterval);
         antiAfkInterval = null;
      }
      if (walkInterval) {
         clearInterval(walkInterval);
         walkInterval = null;
      }
   });

   bot.on('goal_reached', () => {
      console.log(
         `\x1b[32m[AfkBot] Bot arrived at the target location. ${bot.entity.position}\x1b[0m`
      );
   });

   bot.on('death', () => {
      console.log(
         `\x1b[33m[AfkBot] Bot has died and was respawned at ${bot.entity.position}`,
         '\x1b[0m'
      );
   });

   bot.on('kicked', (reason) => {
      console.log('\x1b[33m', `[AfkBot] Bot was kicked from the server. Reason: \n${reason}`, '\x1b[0m');
   });

   bot.on('error', (err) => {
      console.log(`\x1b[31m[ERROR] ${err.message}`, '\x1b[0m');
   });

   bot.on('end', () => {
      console.log('\x1b[33m[AfkBot] Disconnected. Reconnecting in ' + config.utils['auto-recconect-delay'] + ' seconds...\x1b[0m');
      setTimeout(() => {
         console.log('\x1b[32m[AfkBot] Attempting to reconnect...\x1b[0m');
         createBot();
      }, config.utils['auto-recconect-delay'] * 1000);
   });
}

createBot();
