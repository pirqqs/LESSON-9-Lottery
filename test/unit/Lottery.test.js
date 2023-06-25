const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers, network } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", function () {
          let Lottery, VRFCoordinatorV2Mock, entranceFee, deployer, interval
          const chainId = network.config.chainId
          beforeEach(async function () {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"])
              //   const { deployer } = await getNamedAccounts(await deployments.fixture(["all"]))
              Lottery = await ethers.getContract("Lottery", deployer)
              interval = await Lottery.getInterval()
              VRFCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              entranceFee = await Lottery.getEntranceFee()
              deployer = (await getNamedAccounts()).deployer
          })
          describe("constructor", function () {
              it("Initializes the Lottery correctly", async function () {
                  //Ideally we make our tests have 1 assert per "it"
                  const lotteryState = await Lottery.getLotteryState()
                  assert.equal(lotteryState.toString(), "0")
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })

          describe("enterLottery", function () {
              it("reverts when you don't pay enough", async function () {
                  await expect(Lottery.enterLottery()).to.be.revertedWith(
                      "Lottery__SendMoreToEnterLottery"
                  )
              })

              it("records players when they enter", async function () {
                  await Lottery.enterLottery({ value: entranceFee })
                  const playerFromContract = await Lottery.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("emits event on enter", async function () {
                  await expect(Lottery.enterLottery({ value: entranceFee })).to.emit(
                      Lottery,
                      "LotteryEnter"
                  )
              })

              it("doesn't allow entrance when Lottery is calculating", async () => {
                  await Lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  // We pretend to be Chainlink Automation
                  await Lottery.performUpkeep([]) // changes the state to calculating for our comparison below
                  await expect(Lottery.enterLottery({ value: entranceFee })).to.be.revertedWith(
                      // is reverted as Lottery is calculating
                      "Lottery__LotteryNotOpen"
                  )
              })
          })

          describe("checkUpkeep", function () {
              it("returns false if people haven't sent any ETH", async function () {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await Lottery.callStatic.checkUpkeep([])
                  assert(!upkeepNeeded)
              })
              it("returns false if lottery isn't open", async () => {
                  await Lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  await Lottery.performUpkeep([]) // changes the state to calculating
                  const lotteryState = await Lottery.getLotteryState() // stores the new state
                  const { upkeepNeeded } = await Lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert.equal(lotteryState.toString() == "1", upkeepNeeded == false)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await Lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await Lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(!upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await Lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const { upkeepNeeded } = await Lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                  assert(upkeepNeeded)
              })
          })

          describe("performUpkeep", function () {
              it("it can only run if checkUpkeep is true", async function () {
                  await Lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const tx = await Lottery.performUpkeep("0x")
                  assert(tx)
              })
              it("revert if checkUpkeep is false", async function () {
                  await expect(Lottery.performUpkeep("0x")).to.be.revertedWith(
                      "Lottery__UpkeepNotNeeded"
                  )
              })
              it("updates the lottery state, emits and event, and calls the vrf coordinator", async function () {
                  await Lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.request({ method: "evm_mine", params: [] })
                  const txResponse = await Lottery.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  const requestId = txReceipt.events[1].args.requestId
                  const LotteryState = await Lottery.getLotteryState()
                  assert(requestId.toNumber() > 0)
                  assert(LotteryState == 1)
              })
          })

          describe("fulfillRandomWords", function () {
              this.beforeEach(async function () {
                  await Lottery.enterLottery({ value: entranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can o nly be alled after performUpkeep", async function () {
                  await expect(
                      VRFCoordinatorV2Mock.fulfillRandomWords(0, Lottery.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      VRFCoordinatorV2Mock.fulfillRandomWords(1, Lottery.address)
                  ).to.be.revertedWith("nonexistent request")
              })

              it("picks a winner, resets the lottery, and sends money", async function () {
                  const additionalEntrants = 3
                  const startingAccountIndex = 1 //deployer is 0
                  const accounts = await ethers.getSigners()
                  for (
                      let i = startingAccountIndex;
                      i < startingAccountIndex + additionalEntrants;
                      i++
                  ) {
                      const accountConnectedLottery = Lottery.connect(accounts[i])
                      await accountConnectedLottery.enterLottery({ value: entranceFee })
                  }
                  const startingTimeStamp = await Lottery.getLastTimeStamp()

                  // performUpkeep (mock beeing chainlink automation)
                  // fulfillRandomWords (mock beeing the Chainlink VRF)
                  // We will have to wait for the fulfillRandomWords to be called
                  await new Promise(async (resolve, reject) => {
                      Lottery.once("WinnerPicked", async () => {
                          console.log("Found the event!")
                          try {
                              const recentWinner = await Lottery.getRecentWinner()
                              const lotteryState = await Lottery.getLotteryState()
                              const endingTimeStamp = await Lottery.getLastTimeStamp()
                              const numPlayers = await Lottery.getNumberOfPlayers()
                              const winnerEndingBalance = await accounts[1].getBalance()
                              //   const { gasUsed, effectiveGasPrice } = txReceipt
                              //   const gasCost = gasUsed.mul(effectiveGasPrice)
                              console.log(recentWinner)
                              console.log(accounts[0].address)
                              console.log(accounts[1].address)
                              console.log(accounts[2].address)
                              console.log(accounts[3].address)
                              assert.equal(numPlayers.toString(), 0)
                              assert.equal(lotteryState, 0)
                              assert(endingTimeStamp > startingTimeStamp)
                              assert.equal(
                                  winnerEndingBalance.toString(),
                                  winnerStartingBalance.add(
                                      entranceFee
                                          .mul(additionalEntrants)
                                          .add(entranceFee)
                                          .toString()
                                  )
                              )
                          } catch (e) {
                              reject(e)
                          }
                          resolve()
                      })
                      // Setting up the listener
                      // below, we will fire the event, and the listener will pick it up, and resolve
                      // Mocking the Chainlink Automation
                      const tx = await Lottery.performUpkeep([])
                      const txReceipt = await tx.wait(1)
                      const winnerStartingBalance = await accounts[1].getBalance()
                      // Mocking the Chainlink VRF
                      // This function will return a "WinnerPicked", so our Promise will be resolved
                      await VRFCoordinatorV2Mock.fulfillRandomWords(
                          txReceipt.events[1].args.requestId,
                          Lottery.address
                      )
                  })
              })
          })
      })
